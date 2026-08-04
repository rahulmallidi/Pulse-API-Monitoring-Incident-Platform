import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ProbeResultEvent, probeResultEventSchema } from "@pulse/contracts";
import { evaluateAlert } from "@pulse/core";
import { prisma } from "@pulse/db";
import { createKafka, createRedis, TOPICS } from "@pulse/runtime";
import { Consumer, Producer } from "kafkajs";
import { DeliveryService } from "./delivery.service";

const VENDOR_CHECK_MAPPING: Record<string, string[]> = {
  github: ["github-api", "github-status", "github-dns"],
  openai: ["openai-api"],
  stripe: ["stripe-api", "stripe-checkout-synthetic"],
  cloudflare: ["cloudflare-api", "cloudflare-dns"],
  npm: ["npm-registry"],
  pypi: ["pypi"],
  docker: ["docker-hub"]
};

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka = createKafka();
  private readonly consumer: Consumer = this.kafka.consumer({ groupId: "alerter" });
  private readonly producer: Producer = this.kafka.producer();
  private readonly redis = createRedis();
  private recheckTimer: NodeJS.Timeout | null = null;
  private readonly checkCache = new Map<string, { id: string; tenantId: string; name: string; tags: string[]; loadedAt: number }>();

  constructor(private readonly deliveryService: DeliveryService) {}
  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.producer.connect();
    this.recheckTimer = setInterval(() => {
      void this.recheckUnconfirmedIncidents();
    }, 60_000);

    await this.consumer.subscribe({ topic: TOPICS.probesResults, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) {
          return;
        }

        const parsed = probeResultEventSchema.parse(JSON.parse(message.value.toString()));
        await this.handleProbeResult(parsed);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.recheckTimer) {
      clearInterval(this.recheckTimer);
      this.recheckTimer = null;
    }

    await this.consumer.disconnect();
    await this.producer.disconnect();
    await this.redis.quit();
  }

  evaluate(result: ProbeResultEvent, checkId: string, vendorTag: string | null): { shouldAlert: boolean; fingerprint: string } {
    return evaluateAlert({
      checkId,
      vendorTag,
      ok: result.sample.ok,
      error: result.sample.error,
      statusCode: result.sample.statusCode
    });
  }

  private async handleProbeResult(result: ProbeResultEvent): Promise<void> {
    const check = await this.getCheck(result.sample.checkId);
    if (!check) {
      return;
    }

    const vendorTag = this.extractVendorTag(check.tags);
    await this.recordBaselineHeartbeat(check.tags, result);

    const evaluation = this.evaluate(result, check.id, vendorTag);
    if (!evaluation.shouldAlert) {
      return;
    }

    if (await this.shouldSuppressNetworkFailure(result, check.tags)) {
      return;
    }

    const dedupKey = `alert:fingerprint:${evaluation.fingerprint}`;
    const dedupResult = await this.redis.set(dedupKey, "1", "EX", 300, "NX");
    if (!dedupResult) {
      return;
    }

    const correlation = await this.getCorrelation(check.name, vendorTag, new Date(result.sample.time));

    const incident = await prisma.incident.create({
      data: {
        tenantId: check.tenantId,
        checkId: check.id,
        fingerprint: evaluation.fingerprint,
        state: "investigating",
        severity: "high",
        source: correlation.source,
        vendorTag: correlation.vendorTag,
        correlationStatus: correlation.correlationStatus,
        correlatedVendorIncidentId: correlation.correlatedVendorIncidentId,
        confirmedByVendorAt: correlation.confirmedByVendorAt,
        openedAt: new Date(result.sample.time)
      }
    });

    if (correlation.correlationMessage) {
      await prisma.incidentUpdate.create({
        data: {
          incidentId: incident.id,
          state: incident.state,
          message: correlation.correlationMessage
        }
      });
    }

    await this.producer.send({
      topic: TOPICS.alertsRaised,
      messages: [
        {
          key: check.id,
          value: JSON.stringify({
            incidentId: incident.id,
            tenantId: check.tenantId,
            checkId: check.id,
            fingerprint: incident.fingerprint,
            openedAt: incident.openedAt.toISOString()
          })
        }
      ]
    });

    await this.deliveryService.dispatch({
      incidentId: incident.id,
      tenantId: check.tenantId,
      checkId: check.id,
      checkName: check.name,
      region: result.sample.region,
      severity: incident.severity,
      source: incident.source,
      fingerprint: incident.fingerprint,
      error: result.sample.error,
      statusCode: result.sample.statusCode,
      latencyMs: result.sample.latencyMs,
      openedAt: incident.openedAt.toISOString(),
      correlationMessage: correlation.correlationMessage
    });
  }

  private extractVendorTag(tags: string[]): string | null {
    const token = tags.find((tag) => tag.startsWith("vendor:"));
    if (!token) {
      return null;
    }

    const [, vendor] = token.split(":");
    return vendor || null;
  }

  private async getCheck(checkId: string): Promise<{ id: string; tenantId: string; name: string; tags: string[] } | null> {
    const cached = this.checkCache.get(checkId);
    if (cached && Date.now() - cached.loadedAt <= 60_000) {
      return { id: cached.id, tenantId: cached.tenantId, name: cached.name, tags: cached.tags };
    }

    const row = await prisma.check.findUnique({
      where: { id: checkId },
      select: { id: true, tenantId: true, name: true, tags: true }
    });

    if (!row) {
      return null;
    }

    this.checkCache.set(checkId, {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      tags: row.tags,
      loadedAt: Date.now()
    });

    return row;
  }

  private async recordBaselineHeartbeat(tags: string[], result: ProbeResultEvent): Promise<void> {
    const isBaseline = tags.includes("baseline");
    if (!isBaseline || !result.sample.ok) {
      return;
    }

    await this.redis.set(`probe:baseline-ok:${result.sample.region}`, "1", "EX", 120);
  }

  private async shouldSuppressNetworkFailure(result: ProbeResultEvent, tags: string[]): Promise<boolean> {
    if (result.sample.ok || tags.includes("baseline")) {
      return false;
    }

    const errorText = (result.sample.error ?? "").toLowerCase();
    const looksLikeWorkerNetworkIssue =
      errorText.includes("probe_worker_network_error") ||
      errorText.includes("enotfound") ||
      errorText.includes("eai_again") ||
      errorText.includes("econnrefused") ||
      errorText.includes("network") ||
      errorText.includes("timeout");

    if (!looksLikeWorkerNetworkIssue) {
      return false;
    }

    const baselineHeartbeat = await this.redis.get(`probe:baseline-ok:${result.sample.region}`);
    return !baselineHeartbeat;
  }

  private async getCorrelation(
    checkName: string,
    vendorTag: string | null,
    openedAt: Date
  ): Promise<{
    source: "pulse" | "confirmed";
    vendorTag: string | null;
    correlationStatus: "confirmed" | "unconfirmed" | null;
    correlatedVendorIncidentId: string | null;
    confirmedByVendorAt: Date | null;
    correlationMessage: string | null;
  }> {
    if (!vendorTag) {
      return {
        source: "pulse",
        vendorTag: null,
        correlationStatus: null,
        correlatedVendorIncidentId: null,
        confirmedByVendorAt: null,
        correlationMessage: null
      };
    }

    const activeVendorIncidents = await prisma.vendorIncident.findMany({
      where: {
        vendorTag,
        status: { not: "resolved" }
      },
      orderBy: { updatedAt: "desc" },
      take: 20
    });

    const activeVendorIncident = activeVendorIncidents.find((incident) =>
      this.incidentMatchesCheck(vendorTag, checkName, incident.affectedComponents)
    ) ?? activeVendorIncidents[0] ?? null;

    if (!activeVendorIncident) {
      return {
        source: "pulse",
        vendorTag,
        correlationStatus: "unconfirmed",
        correlatedVendorIncidentId: null,
        confirmedByVendorAt: null,
        correlationMessage: `Not yet reported by ${this.vendorDisplay(vendorTag)}`
      };
    }

    const pivot = activeVendorIncident.startedAt ?? activeVendorIncident.updatedAt;
    const deltaMs = Math.abs(pivot.getTime() - openedAt.getTime());
    const isWithinWindow = deltaMs <= 10 * 60 * 1_000;

    if (isWithinWindow) {
      const minutesAfterPulse = Math.max(0, Math.round((activeVendorIncident.updatedAt.getTime() - openedAt.getTime()) / 60_000));
      return {
        source: "confirmed",
        vendorTag,
        correlationStatus: "confirmed",
        correlatedVendorIncidentId: activeVendorIncident.incidentId,
        confirmedByVendorAt: activeVendorIncident.updatedAt,
        correlationMessage: `Confirmed by ${this.vendorDisplay(vendorTag)} - reported ${minutesAfterPulse}m after Pulse detected`
      };
    }

    return {
      source: "pulse",
      vendorTag,
      correlationStatus: "unconfirmed",
      correlatedVendorIncidentId: null,
      confirmedByVendorAt: null,
      correlationMessage: `Not yet reported by ${this.vendorDisplay(vendorTag)}`
    };
  }

  private vendorDisplay(vendorTag: string): string {
    return vendorTag.charAt(0).toUpperCase() + vendorTag.slice(1);
  }

  private async recheckUnconfirmedIncidents(): Promise<void> {
    const pending = await prisma.incident.findMany({
      where: {
        state: { not: "resolved" },
        correlationStatus: "unconfirmed",
        vendorTag: { not: null }
      }
    });

    for (const incident of pending) {
      if (!incident.vendorTag) {
        continue;
      }

      const activeVendorIncident = await prisma.vendorIncident.findFirst({
        where: {
          vendorTag: incident.vendorTag,
          status: { not: "resolved" }
        },
        orderBy: { updatedAt: "desc" }
      });

      if (!activeVendorIncident) {
        continue;
      }

      const confirmedAt = activeVendorIncident.updatedAt;
      const minutesAfterPulse = Math.max(0, Math.round((confirmedAt.getTime() - incident.openedAt.getTime()) / 60_000));

      await prisma.incident.update({
        where: { id: incident.id },
        data: {
          source: "confirmed",
          correlationStatus: "confirmed",
          correlatedVendorIncidentId: activeVendorIncident.incidentId,
          confirmedByVendorAt: confirmedAt
        }
      });

      await prisma.incidentUpdate.create({
        data: {
          incidentId: incident.id,
          state: incident.state,
          message: `Confirmed by ${this.vendorDisplay(incident.vendorTag)} - reported ${minutesAfterPulse}m after Pulse detected`
        }
      });
    }
  }

  private incidentMatchesCheck(vendorTag: string, checkName: string, affectedComponents: unknown): boolean {
    const mappedChecks = VENDOR_CHECK_MAPPING[vendorTag] ?? [];
    if (mappedChecks.length === 0) {
      return true;
    }

    if (!mappedChecks.includes(checkName)) {
      return false;
    }

    if (!Array.isArray(affectedComponents) || affectedComponents.length === 0) {
      return true;
    }

    const normalizedCheck = checkName.toLowerCase();
    return affectedComponents.some((component) => {
      if (!component || typeof component !== "object") {
        return false;
      }

      const name = (component as { name?: unknown }).name;
      if (typeof name !== "string") {
        return false;
      }

      const normalizedName = name.toLowerCase();
      return normalizedCheck.includes(normalizedName) || normalizedName.includes(normalizedCheck);
    });
  }
}
