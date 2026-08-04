import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@pulse/db";
import { createRedis } from "@pulse/runtime";
import { STATUSPAGE_HOSTS, StatuspageHost } from "../seed/statuspage-hosts";

const USER_AGENT = "Pulse-Monitor/0.1 (+https://github.com/you/pulse; contact@example.com)";
const SUMMARY_CACHE_TTL_SECONDS = 45;
const BASE_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 32 * 60_000;

type StatuspageComponent = {
  id: string;
  name: string;
  status: "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance" | string;
  updated_at: string;
};

type StatuspageIncidentUpdate = {
  id: string;
  status: string;
  body: string;
  created_at: string;
  updated_at: string;
};

type StatuspageIncident = {
  id: string;
  name: string;
  status: "investigating" | "identified" | "monitoring" | "resolved" | "postmortem" | string;
  impact: "none" | "minor" | "major" | "critical" | string;
  started_at: string | null;
  resolved_at: string | null;
  updated_at: string;
  shortlink?: string;
  components?: Array<{ id: string; name: string; status: string }>;
  incident_updates?: StatuspageIncidentUpdate[];
};

type StatuspageSummaryResponse = {
  page?: { id?: string; name?: string; url?: string };
  components?: StatuspageComponent[];
  incidents?: StatuspageIncident[];
  scheduled_maintenances?: unknown[];
};

type StatuspageIncidentsResponse = {
  incidents?: StatuspageIncident[];
};

class HttpStatusError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

@Injectable()
export class StatuspageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatuspageService.name);
  private readonly redis = createRedis();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly historyPullAt = new Map<string, number>();
  private stopping = false;

  async onModuleInit(): Promise<void> {
    for (const [index, host] of STATUSPAGE_HOSTS.entries()) {
      this.scheduleHost(host, index * 2_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    await this.redis.quit();
  }

  private scheduleHost(host: StatuspageHost, delayMs: number): void {
    if (this.stopping) {
      return;
    }

    const existing = this.timers.get(host.vendorTag);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(() => {
      void this.pollHost(host);
    }, Math.max(1_000, delayMs));

    this.timers.set(host.vendorTag, timeout);
  }

  private async pollHost(host: StatuspageHost): Promise<void> {
    if (this.stopping) {
      return;
    }

    const now = new Date();

    try {
      const summary = await this.fetchJson<StatuspageSummaryResponse>(host.host, "/api/v2/summary.json");
      await this.redis.setex(this.summaryCacheKey(host.vendorTag), SUMMARY_CACHE_TTL_SECONDS, JSON.stringify(summary));
      await this.persistSummary(host, summary);

      const shouldPullHistory = this.shouldPullHistory(host.vendorTag);
      if (shouldPullHistory) {
        const history = await this.fetchJson<StatuspageIncidentsResponse>(host.host, "/api/v2/incidents.json");
        await this.persistIncidents(host, history.incidents ?? [], summary.page?.url ?? null);
        this.historyPullAt.set(host.vendorTag, Date.now());
      }

      await prisma.vendorPollState.upsert({
        where: { vendorTag: host.vendorTag },
        update: {
          host: host.host,
          consecutiveFailures: 0,
          isStale: false,
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastError: null,
          backoffUntil: null
        },
        create: {
          vendorTag: host.vendorTag,
          host: host.host,
          consecutiveFailures: 0,
          isStale: false,
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastError: null,
          backoffUntil: null
        }
      });

      this.scheduleHost(host, BASE_INTERVAL_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statuspage poll failed";
      const statusCode = error instanceof HttpStatusError ? error.statusCode : null;
      const currentState = await prisma.vendorPollState.findUnique({ where: { vendorTag: host.vendorTag } });
      const failures = (currentState?.consecutiveFailures ?? 0) + 1;
      const stale = failures >= 5;
      const shouldBackoff = statusCode === 429 || (statusCode !== null && statusCode >= 500);
      const nextDelay = shouldBackoff
        ? Math.min(BASE_INTERVAL_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS)
        : BASE_INTERVAL_MS;
      const backoffUntil = new Date(Date.now() + nextDelay);

      await prisma.vendorPollState.upsert({
        where: { vendorTag: host.vendorTag },
        update: {
          host: host.host,
          consecutiveFailures: failures,
          isStale: stale,
          lastAttemptAt: now,
          lastError: message,
          backoffUntil: backoffUntil
        },
        create: {
          vendorTag: host.vendorTag,
          host: host.host,
          consecutiveFailures: failures,
          isStale: stale,
          lastAttemptAt: now,
          lastError: message,
          backoffUntil: backoffUntil
        }
      });

      if (stale) {
        this.logger.warn(`Statuspage stream stale for ${host.vendorTag}: ${message}`);
      } else {
        this.logger.warn(`Statuspage poll failure for ${host.vendorTag}: ${message}`);
      }

      this.scheduleHost(host, nextDelay);
    }
  }

  private shouldPullHistory(vendorTag: string): boolean {
    const lastAt = this.historyPullAt.get(vendorTag);
    if (!lastAt) {
      return true;
    }

    return Date.now() - lastAt >= 60 * 60_000;
  }

  private async fetchJson<T>(host: string, path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(`https://${host}${path}`, {
        method: "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new HttpStatusError(response.status, `HTTP ${response.status} from ${host}${path}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistSummary(host: StatuspageHost, summary: StatuspageSummaryResponse): Promise<void> {
    await this.persistComponents(host.vendorTag, summary.components ?? []);
    await this.persistIncidents(host, summary.incidents ?? [], summary.page?.url ?? null);
  }

  private async persistComponents(vendorTag: string, components: StatuspageComponent[]): Promise<void> {
    const now = new Date();

    for (const component of components) {
      await prisma.vendorComponent.upsert({
        where: {
          vendorTag_componentId: {
            vendorTag,
            componentId: component.id
          }
        },
        update: {
          name: component.name,
          status: component.status,
          updatedAt: this.parseDate(component.updated_at, now)
        },
        create: {
          vendorTag,
          componentId: component.id,
          name: component.name,
          status: component.status,
          updatedAt: this.parseDate(component.updated_at, now),
          firstSeenAt: now
        }
      });
    }
  }

  private async persistIncidents(host: StatuspageHost, incidents: StatuspageIncident[], sourceUrl: string | null): Promise<void> {
    const now = new Date();

    for (const incident of incidents) {
      await prisma.vendorIncident.upsert({
        where: {
          vendorTag_incidentId: {
            vendorTag: host.vendorTag,
            incidentId: incident.id
          }
        },
        update: {
          name: incident.name,
          status: incident.status,
          impact: incident.impact,
          startedAt: this.parseOptionalDate(incident.started_at),
          resolvedAt: this.parseOptionalDate(incident.resolved_at),
          updatedAt: this.parseDate(incident.updated_at, now),
          affectedComponents: incident.components ?? [],
          updates: incident.incident_updates ?? [],
          sourceUrl: incident.shortlink ?? sourceUrl
        },
        create: {
          vendorTag: host.vendorTag,
          incidentId: incident.id,
          name: incident.name,
          status: incident.status,
          impact: incident.impact,
          startedAt: this.parseOptionalDate(incident.started_at),
          resolvedAt: this.parseOptionalDate(incident.resolved_at),
          updatedAt: this.parseDate(incident.updated_at, now),
          affectedComponents: incident.components ?? [],
          updates: incident.incident_updates ?? [],
          sourceUrl: incident.shortlink ?? sourceUrl,
          firstSeenAt: now
        }
      });
    }
  }

  private parseDate(value: string, fallback: Date): Date {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  private parseOptionalDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private summaryCacheKey(vendorTag: string): string {
    return `statuspage:summary:${vendorTag}`;
  }
}
