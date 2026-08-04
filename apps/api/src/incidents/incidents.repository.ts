import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Incident, IncidentTransitionInput, IncidentUpdateInput, incidentStateSchema } from "@pulse/contracts";
import { prisma } from "@pulse/db";

const transitionOrder: Record<string, number> = {
  investigating: 0,
  identified: 1,
  monitoring: 2,
  resolved: 3
};

@Injectable()
export class IncidentsRepository {
  async listByTenant(tenantId: string): Promise<Incident[]> {
    const [rows, vendorIncidents, staleStates] = await Promise.all([
      prisma.incident.findMany({
        where: { tenantId },
        orderBy: { openedAt: "desc" }
      }),
      prisma.vendorIncident.findMany({
        where: { status: { not: "resolved" } },
        orderBy: { updatedAt: "desc" },
        take: 50
      }),
      prisma.vendorPollState.findMany({
        where: { isStale: true },
        select: { vendorTag: true }
      })
    ]);

    const staleVendors = new Set(staleStates.map((state) => state.vendorTag));

    const pulseIncidents = rows.map((row) => this.mapPulseIncident(row, staleVendors));
    const linkedVendorIncidentIds = new Set(
      rows
        .map((row) => row.correlatedVendorIncidentId)
        .filter((value): value is string => Boolean(value))
    );

    const reportedOnly = vendorIncidents
      .filter((vendorIncident) => !linkedVendorIncidentIds.has(vendorIncident.incidentId))
      .map((vendorIncident) => this.mapVendorOnlyIncident(tenantId, vendorIncident, staleVendors));

    return [...pulseIncidents, ...reportedOnly].sort((a, b) =>
      new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
    );
  }

  async transition(incidentId: string, input: IncidentTransitionInput): Promise<Incident> {
    const current = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!current) {
      throw new NotFoundException(`Incident ${incidentId} was not found`);
    }

    if (transitionOrder[input.state] < transitionOrder[current.state]) {
      throw new BadRequestException("Incident state cannot move backwards");
    }

    const resolvedAt = input.state === "resolved" ? new Date() : current.resolvedAt;

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        state: input.state,
        resolvedAt
      }
    });

    if (input.message) {
      await prisma.incidentUpdate.create({
        data: {
          incidentId,
          message: input.message,
          state: input.state
        }
      });
    }

    return this.mapPulseIncident(updated, new Set<string>());
  }

  async addUpdate(incidentId: string, input: IncidentUpdateInput): Promise<void> {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      throw new NotFoundException(`Incident ${incidentId} was not found`);
    }

    await prisma.incidentUpdate.create({
      data: {
        incidentId,
        message: input.message,
        state: input.state ?? incident.state
      }
    });
  }

  private mapPulseIncident(row: {
    id: string;
    tenantId: string;
    checkId: string;
    fingerprint: string;
    state: string;
    severity: string;
    source: string;
    vendorTag: string | null;
    correlationStatus: string | null;
    correlatedVendorIncidentId: string | null;
    confirmedByVendorAt: Date | null;
    openedAt: Date;
    resolvedAt: Date | null;
  }, staleVendors: Set<string>): Incident {
    return {
      id: row.id,
      tenantId: row.tenantId,
      checkId: row.checkId,
      fingerprint: row.fingerprint,
      state: incidentStateSchema.parse(row.state),
      severity: row.severity as Incident["severity"],
      source: this.normalizeSource(row.source),
      vendorTag: row.vendorTag,
      correlationStatus: this.normalizeCorrelationStatus(row.correlationStatus),
      correlatedVendorIncidentId: row.correlatedVendorIncidentId,
      confirmedByVendorAt: row.confirmedByVendorAt ? row.confirmedByVendorAt.toISOString() : null,
      correlationMessage: this.buildCorrelationMessage(
        row.source,
        row.vendorTag,
        row.openedAt,
        row.confirmedByVendorAt,
        row.correlationStatus,
        staleVendors
      ),
      openedAt: row.openedAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null
    };
  }

  private mapVendorOnlyIncident(
    tenantId: string,
    vendorIncident: {
      vendorTag: string;
      incidentId: string;
      name: string;
      status: string;
      impact: string;
      startedAt: Date | null;
      resolvedAt: Date | null;
      updatedAt: Date;
    },
    staleVendors: Set<string>
  ): Incident {
    const openedAt = vendorIncident.startedAt ?? vendorIncident.updatedAt;

    return {
      id: `reported:${vendorIncident.vendorTag}:${vendorIncident.incidentId}`,
      tenantId,
      checkId: null,
      fingerprint: `vendor:${vendorIncident.vendorTag}:${vendorIncident.incidentId}`,
      state: this.vendorStatusToIncidentState(vendorIncident.status),
      severity: this.vendorImpactToSeverity(vendorIncident.impact),
      source: "reported",
      vendorTag: vendorIncident.vendorTag,
      correlationStatus: "vendor_only",
      correlatedVendorIncidentId: vendorIncident.incidentId,
      confirmedByVendorAt: null,
      correlationMessage: staleVendors.has(vendorIncident.vendorTag)
        ? `Statuspage data unavailable for ${this.vendorDisplay(vendorIncident.vendorTag)}, showing probe data only.`
        : `Reported by ${this.vendorDisplay(vendorIncident.vendorTag)} - Pulse probes unaffected`,
      openedAt: openedAt.toISOString(),
      resolvedAt: vendorIncident.resolvedAt ? vendorIncident.resolvedAt.toISOString() : null
    };
  }

  private vendorStatusToIncidentState(status: string): Incident["state"] {
    if (status === "identified") {
      return "identified";
    }
    if (status === "monitoring" || status === "postmortem") {
      return "monitoring";
    }
    if (status === "resolved") {
      return "resolved";
    }
    return "investigating";
  }

  private vendorImpactToSeverity(impact: string): Incident["severity"] {
    if (impact === "critical") {
      return "critical";
    }
    if (impact === "major") {
      return "high";
    }
    if (impact === "minor") {
      return "medium";
    }
    return "low";
  }

  private vendorDisplay(vendorTag: string): string {
    return vendorTag.charAt(0).toUpperCase() + vendorTag.slice(1);
  }

  private normalizeSource(value: string): Incident["source"] {
    if (value === "confirmed" || value === "reported") {
      return value;
    }

    return "pulse";
  }

  private normalizeCorrelationStatus(value: string | null): Incident["correlationStatus"] {
    if (value === "confirmed" || value === "unconfirmed" || value === "vendor_only" || value === "both_clear") {
      return value;
    }

    return null;
  }

  private buildCorrelationMessage(
    source: string,
    vendorTag: string | null,
    openedAt: Date,
    confirmedByVendorAt: Date | null,
    correlationStatus: string | null,
    staleVendors: Set<string>
  ): string | null {
    if (!vendorTag) {
      return null;
    }

    if (staleVendors.has(vendorTag)) {
      return `Statuspage data unavailable for ${this.vendorDisplay(vendorTag)}, showing probe data only.`;
    }

    if (source === "confirmed" && confirmedByVendorAt) {
      const minutes = Math.max(0, Math.round((confirmedByVendorAt.getTime() - openedAt.getTime()) / 60_000));
      return `Confirmed by ${this.vendorDisplay(vendorTag)} - reported ${minutes}m after Pulse detected`;
    }

    if (correlationStatus === "unconfirmed") {
      return `Not yet reported by ${this.vendorDisplay(vendorTag)}`;
    }

    return null;
  }

}
