"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveProbePanel } from "./live-probe-panel";
import { useEventStream } from "../hooks/use-event-stream";
import { apiConfig } from "../lib/api-config";

type RangeKey = "1h" | "24h" | "7d" | "30d" | "custom";
type EnvironmentKey = "production" | "staging" | "development";
type ServiceGroup = "all" | "github" | "openai" | "stripe" | "cloudflare" | "baseline" | "other";
type HeatSort = "worst" | "name" | "region";
type HealthState = "healthy" | "degraded" | "down" | "maintenance" | "no-data";

type CheckRow = {
  id: string;
  checkId: string;
  service: string;
  checkName: string;
  region: string;
  statuses: HealthState[];
  totals: number[];
  p95: number;
  errorRate: number;
  uptime24h: number;
  customerAffected: number;
  group: ServiceGroup;
  sampleCount: number;
};

type IncidentRow = {
  id: string;
  checkId: string | null;
  openedAtMs: number;
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  title: string;
  openedAgo: string;
  affectedChecks: number;
  affectedRegions: number;
  acknowledgedBy: string;
  state: "investigating" | "identified" | "monitoring";
  source: "pulse" | "confirmed" | "reported";
  correlationMessage: string | null;
  spark: number[];
  startIndex: number;
};

type ApiIncident = {
  id: string;
  checkId: string | null;
  severity: "critical" | "high" | "medium" | "low";
  state: "investigating" | "identified" | "monitoring" | "resolved";
  source: "pulse" | "confirmed" | "reported";
  vendorTag: string | null;
  correlationMessage: string | null;
  openedAt: string;
};

type ApiCheck = {
  id: string;
  name: string;
  regions?: string[];
  tags?: string[];
};

type ProbeStreamEvent = {
  sample: {
    checkId: string;
    region: string;
    ok: boolean;
    latencyMs: number;
  };
  receivedAt: string;
};

type LatencySeriesResponse = {
  points: number;
  sampleCount: number;
  buckets?: string[];
  p50: Array<number | null>;
  p95: Array<number | null>;
  p99: Array<number | null>;
};

type MetricsSummaryResponse = {
  sampleCount: number;
  uptimePct: number;
  errorRatePct: number;
  p50: number;
  p95: number;
  p99: number;
};

type HeatmapResponse = {
  points: number;
  buckets: string[];
  rows: Array<{
    checkId: string;
    checkName: string;
    region: string;
    statuses: HealthState[];
    totals?: number[];
    p95: number;
    errorRate: number;
    uptimePct: number;
    sampleCount: number;
  }>;
};

type RegionalSummaryRow = {
  region: string;
  checks: number;
  uptimePct: number;
  p95: number;
  errorRatePct: number;
  sampleCount: number;
};

const incidentsApiUrl = apiConfig.incidents;
const checksApiUrl = apiConfig.checks;
const sseApiUrl = apiConfig.sse;
const latencySeriesApiUrl = apiConfig.latencySeries;
const metricsSummaryApiUrl = apiConfig.metricsSummary;
const heatmapApiUrl = apiConfig.heatmap;
const regionalApiUrl = apiConfig.regional;
const notifiersApiUrl = apiConfig.notifiers;
const demoTenantId = "11111111-1111-1111-1111-111111111111";
const demoTenantSlug = "demo-acme";

function matchesEnvironment(tags: string[] | undefined, environment: EnvironmentKey): boolean {
  const normalized = (tags ?? []).map((tag) => tag.toLowerCase());
  const envTag = `env:${environment}`;
  if (normalized.includes(envTag)) {
    return true;
  }

  if (environment === "production") {
    return !normalized.includes("env:staging") && !normalized.includes("env:development");
  }

  return false;
}

const rangeOptions: { key: RangeKey; label: string; hours: number }[] = [
  { key: "1h", label: "Last 1h", hours: 1 },
  { key: "24h", label: "Last 24h", hours: 24 },
  { key: "7d", label: "Last 7d", hours: 168 },
  { key: "30d", label: "Last 30d", hours: 720 },
  { key: "custom", label: "Custom...", hours: 24 }
];

const regions = ["us-east", "eu-west", "ap-south"];

function normalizeRegion(region: string): "us-east" | "eu-west" | "ap-south" | null {
  const value = region.toLowerCase();
  if (value === "us-east" || value === "us-east-1") return "us-east";
  if (value === "eu-west" || value === "eu-west-1") return "eu-west";
  if (value === "ap-south" || value === "ap-south-1") return "ap-south";
  return null;
}

function formatBucketLabel(iso: string | undefined, range: RangeKey): string {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");

  if (range === "1h" || range === "24h") {
    return `${hh}:${mm}`;
  }

  if (range === "7d") {
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
    return `${weekday} ${hh}:00`;
  }

  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}`;
}

function toChartPath(values: Array<number | null>, scaleXFn: (index: number) => number, scaleYFn: (value: number) => number): string {
  const parts: string[] = [];
  let drawing = false;

  values.forEach((value, index) => {
    if (value == null) {
      drawing = false;
      return;
    }

    const command = drawing ? "L" : "M";
    parts.push(`${command}${scaleXFn(index).toFixed(2)},${scaleYFn(value).toFixed(2)}`);
    drawing = true;
  });

  return parts.join(" ");
}

/** Carry last known value across gaps so sparse probe windows still draw continuous lines. */
function forwardFillSeries(values: Array<number | null>): Array<number | null> {
  let last: number | null = null;
  const filled = values.map((value) => {
    if (value != null) {
      last = value;
      return value;
    }
    return last;
  });

  const first = filled.findIndex((value) => value != null);
  if (first <= 0) {
    return filled;
  }

  const seed = filled[first];
  for (let i = 0; i < first; i += 1) {
    filled[i] = seed ?? null;
  }
  return filled;
}

function robustLatencyMax(series: {
  p50: Array<number | null>;
  p95: Array<number | null>;
  p99: Array<number | null>;
}): number {
  const p50 = series.p50.filter((value): value is number => value != null && value >= 0);
  const p95 = series.p95.filter((value): value is number => value != null && value >= 0);
  const p99 = series.p99.filter((value): value is number => value != null && value >= 0);

  const primary = [...p50, ...p95];
  if (primary.length === 0 && p99.length === 0) {
    return 100;
  }

  const sortedPrimary = [...(primary.length > 0 ? primary : p99)].sort((a, b) => a - b);
  const p95Cap = sortedPrimary[Math.min(sortedPrimary.length - 1, Math.floor(sortedPrimary.length * 0.9))] ?? 100;
  const hardCap = Math.max(250, p95Cap * 3);

  const included = [
    ...primary,
    ...p99.filter((value) => value <= hardCap)
  ];

  return Math.max(100, ...included) * 1.15;
}

function isNoiseCheckName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("smoke") ||
    normalized.startsWith("failing check") ||
    normalized.includes("pulse demo health")
  );
}

function hasSeriesSignal(series: LatencySeriesResponse | null): boolean {
  if (!series || series.sampleCount <= 0) {
    return false;
  }

  return series.p95.some((value) => value != null && value > 0);
}

function lastKnownStatus(statuses: HealthState[]): HealthState {
  for (let i = statuses.length - 1; i >= 0; i -= 1) {
    if (statuses[i] !== "no-data") {
      return statuses[i];
    }
  }
  return "no-data";
}

const incidentsSeed: IncidentRow[] = [
  {
    id: "INC-482",
    checkId: null,
    openedAtMs: Date.now() - 14 * 60_000,
    severity: "SEV-1",
    title: "Checkout API failing in eu-west-1",
    openedAgo: "14 min ago",
    affectedChecks: 12,
    affectedRegions: 3,
    acknowledgedBy: "Priya",
    state: "investigating",
    source: "confirmed",
    correlationMessage: "Confirmed by Stripe - reported 4m after Pulse detected",
    spark: [210, 235, 260, 290, 320, 410, 520, 640, 760, 810],
    startIndex: 5
  },
  {
    id: "INC-479",
    checkId: null,
    openedAtMs: Date.now() - 38 * 60_000,
    severity: "SEV-2",
    title: "Search API latency increase in us-east-1",
    openedAgo: "38 min ago",
    affectedChecks: 5,
    affectedRegions: 1,
    acknowledgedBy: "Marcus",
    state: "identified",
    source: "pulse",
    correlationMessage: "Not yet reported by Openai",
    spark: [170, 180, 195, 208, 222, 240, 260, 255, 244, 232],
    startIndex: 4
  },
  {
    id: "INC-471",
    checkId: null,
    openedAtMs: Date.now() - 2 * 60 * 60_000,
    severity: "SEV-3",
    title: "Auth service intermittent errors in ap-south-1",
    openedAgo: "2h ago",
    affectedChecks: 3,
    affectedRegions: 1,
    acknowledgedBy: "Priya",
    state: "monitoring",
    source: "reported",
    correlationMessage: "Reported by Cloudflare - Pulse probes unaffected",
    spark: [120, 124, 130, 146, 170, 154, 149, 138, 132, 128],
    startIndex: 3
  }
];

const activityRows = [
  "14:22 · Priya acknowledged INC-482",
  "14:20 · Deploy v2.41.0 completed",
  "14:17 · Alert rule edited for checkout-api",
  "14:10 · Maintenance window created for billing-api",
  "14:08 · Marcus snoozed alert ALR-932",
  "14:01 · Incident INC-479 opened",
  "13:54 · Check added checkout-api / eu-west-1",
  "13:47 · SLO updated for auth-service",
  "13:35 · Incident INC-468 resolved",
  "13:18 · Alert channel changed PagerDuty",
  "13:10 · Priya acknowledged INC-471",
  "13:01 · Check paused inventory-api",
  "12:58 · Incident INC-471 opened",
  "12:40 · Deploy v2.40.8 completed",
  "12:33 · Maintenance ended in us-east-1",
  "12:22 · Alert ALR-921 resolved",
  "12:13 · Check threshold edited search-api",
  "12:09 · Incident INC-466 resolved",
  "11:58 · Priya started on-call",
  "11:52 · Alert ALR-915 created"
];

function columnCountForRange(range: RangeKey): number {
  if (range === "1h") return 12;
  if (range === "24h") return 24;
  if (range === "7d") return 42;
  if (range === "30d") return 30;
  return 24;
}

/** Heatmap needs fewer, wider buckets than the latency line chart. */
function heatmapColumnCountForRange(range: RangeKey): number {
  if (range === "1h") return 12;
  if (range === "24h") return 24;
  if (range === "7d") return 42;
  if (range === "30d") return 30;
  return 24;
}

function makeSeries(length: number, base: number, amplitude: number, step: number): number[] {
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((index + 1) / 3.4) * amplitude;
    const drift = Math.cos((index + 4) / 8.2) * (amplitude * 0.4);
    return Math.round(base + wave + drift + index * step);
  });
}

function generateCheckRows(_columns: number): CheckRow[] {
  return [];
}

function stateWeight(state: HealthState): number {
  if (state === "down") return 4;
  if (state === "degraded") return 3;
  if (state === "maintenance") return 2;
  if (state === "no-data") return 1;
  return 0;
}

function inferServiceGroup(value: string, tags: string[] = []): ServiceGroup {
  const normalized = value.toLowerCase();
  const tagBlob = tags.join(" ").toLowerCase();

  if (normalized.includes("github") || tagBlob.includes("vendor:github")) return "github";
  if (normalized.includes("openai") || tagBlob.includes("vendor:openai")) return "openai";
  if (normalized.includes("stripe") || tagBlob.includes("vendor:stripe") || normalized.includes("payment") || normalized.includes("checkout") || normalized.includes("billing")) {
    return "stripe";
  }
  if (normalized.includes("cloudflare") || tagBlob.includes("vendor:cloudflare")) return "cloudflare";
  if (
    normalized.includes("httpbin") ||
    normalized.includes("jsonplaceholder") ||
    normalized.includes("npm") ||
    normalized.includes("pypi") ||
    normalized.includes("docker") ||
    normalized.includes("dns") ||
    tagBlob.includes("baseline")
  ) {
    return "baseline";
  }

  return "other";
}

function statusColorClass(state: HealthState): string {
  if (state === "healthy") return "bg-[var(--status-healthy)]";
  if (state === "degraded") return "bg-[var(--status-degraded)]";
  if (state === "down") return "bg-[var(--status-down)]";
  if (state === "maintenance") return "bg-[var(--status-maintenance)] heat-maintenance";
  return "bg-[var(--status-nodata)]";
}

function statusWord(state: HealthState): "Healthy" | "Degraded" | "Down" | "Maintenance" | "No data" {
  if (state === "healthy") return "Healthy";
  if (state === "degraded") return "Degraded";
  if (state === "down") return "Down";
  if (state === "maintenance") return "Maintenance";
  return "No data";
}

function toSparkPath(data: number[], width: number, height: number): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);

  return data
    .map((point, index) => {
      const x = (index / Math.max(1, data.length - 1)) * width;
      const y = height - ((point - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function topTileDeltaClass(value: string): string {
  if (value.startsWith("+")) return "text-[var(--status-down)]";
  if (value.startsWith("-")) return "text-[var(--status-healthy)]";
  return "text-[var(--text-muted)]";
}

function vendorDisplay(vendorTag: string | null): string {
  if (!vendorTag) {
    return "service";
  }

  return vendorTag.charAt(0).toUpperCase() + vendorTag.slice(1);
}

function severityToBadge(severity: ApiIncident["severity"]): IncidentRow["severity"] {
  if (severity === "critical" || severity === "high") {
    return "SEV-1";
  }
  if (severity === "medium") {
    return "SEV-2";
  }
  return "SEV-3";
}

function toOpenedAgo(iso: string): string {
  const startedAt = new Date(iso).getTime();
  const deltaMs = Math.max(0, Date.now() - startedAt);
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  return `${Math.round(minutes / 60)}h ago`;
}

function sourceChip(source: IncidentRow["source"]): string {
  if (source === "confirmed") {
    return "Confirmed";
  }
  if (source === "reported") {
    return "Reported";
  }
  return "Pulse";
}

function sourceChipClass(source: IncidentRow["source"]): string {
  if (source === "confirmed") {
    return "text-[var(--status-down)]";
  }
  if (source === "reported") {
    return "text-[var(--accent-blue)]";
  }
  return "text-[var(--status-degraded)]";
}

function calculateLatencyStats(events: ProbeStreamEvent[]): {
  p95: number;
  p50: number;
  p99: number;
  uptimePct: number;
  errorRatePct: number;
  sampleCount: number;
} {
  if (events.length === 0) {
    return {
      p95: 0,
      p50: 0,
      p99: 0,
      uptimePct: 100,
      errorRatePct: 0,
      sampleCount: 0
    };
  }

  const latencies = events.map((event) => event.sample.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number): number => {
    const idx = Math.min(latencies.length - 1, Math.max(0, Math.floor((latencies.length - 1) * p)));
    return Math.round(latencies[idx]);
  };

  const success = events.filter((event) => event.sample.ok).length;
  const uptimePct = Number(((success / events.length) * 100).toFixed(2));
  const errorRatePct = Number((100 - uptimePct).toFixed(2));

  return {
    p95: percentile(0.95),
    p50: percentile(0.5),
    p99: percentile(0.99),
    uptimePct,
    errorRatePct,
    sampleCount: events.length
  };
}

function mapApiIncident(incident: ApiIncident): IncidentRow | null {
  if (incident.state === "resolved") {
    return null;
  }

  const seedValue = incident.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const openedAtMs = new Date(incident.openedAt).getTime();
  return {
    id: incident.id,
    checkId: incident.checkId,
    openedAtMs: Number.isNaN(openedAtMs) ? Date.now() : openedAtMs,
    severity: severityToBadge(incident.severity),
    title: incident.source === "reported"
      ? `${vendorDisplay(incident.vendorTag)} reports active incident`
      : `Pulse detected failure for ${incident.vendorTag ?? "service"}`,
    openedAgo: toOpenedAgo(incident.openedAt),
    affectedChecks: 1,
    affectedRegions: 1,
    acknowledgedBy: incident.source === "reported" ? "Vendor" : "Pulse",
    state: incident.state,
    source: incident.source,
    correlationMessage: incident.correlationMessage,
    spark: makeSeries(10, 160 + (seedValue % 220), 42, 0),
    startIndex: 4
  };
}

export function OperationsDashboard(): JSX.Element {
  const [tenant] = useState(demoTenantSlug);
  const [environment, setEnvironment] = useState<EnvironmentKey>("production");
  const [range, setRange] = useState<RangeKey>("24h");
  const [live, setLive] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [serviceGroup, setServiceGroup] = useState<ServiceGroup>("all");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [heatSort, setHeatSort] = useState<HeatSort>("worst");
  const [activityTab, setActivityTab] = useState<"oncall" | "activity" | "alerts">("alerts");
  const [notifiers, setNotifiers] = useState<Array<{ id: string; type: string; url: string; name: string }>>([]);
  const [notifierUrl, setNotifierUrl] = useState("");
  const [notifierType, setNotifierType] = useState<"slack" | "webhook">("slack");
  const [notifierMessage, setNotifierMessage] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const [latencyHoverPosition, setLatencyHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [heatHover, setHeatHover] = useState<{
    checkName: string;
    region: string;
    status: HealthState;
    bucketLabel: string;
    samples: number;
  } | null>(null);
  const [liveIncidents, setLiveIncidents] = useState<IncidentRow[]>([]);
  const [liveChecks, setLiveChecks] = useState<ApiCheck[]>([]);
  const [pausedProbeEvents, setPausedProbeEvents] = useState<ProbeStreamEvent[]>([]);
  const [apiLatencySeries, setApiLatencySeries] = useState<LatencySeriesResponse | null>(null);
  const [latencySeriesSource, setLatencySeriesSource] = useState<"timescale" | "stream" | "empty">("empty");
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummaryResponse | null>(null);
  const [heatmapRows, setHeatmapRows] = useState<CheckRow[]>([]);
  const [heatmapBuckets, setHeatmapBuckets] = useState<string[]>([]);
  const [regionalSummary, setRegionalSummary] = useState<RegionalSummaryRow[]>([]);
  const [clockMs, setClockMs] = useState<number | null>(null);
  const { events: probeEvents } = useEventStream<ProbeStreamEvent>(sseApiUrl, 20_000);

  useEffect(() => {
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!live) {
      setPausedProbeEvents(probeEvents);
    }
  }, [live, probeEvents]);

  const activeProbeEvents = live ? probeEvents : pausedProbeEvents;

  useEffect(() => {
    let disposed = false;

    const loadIncidents = async (): Promise<void> => {
      try {
        const response = await fetch(incidentsApiUrl, {
          headers: {
            "x-tenant-id": demoTenantId
          }
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as ApiIncident[];
        if (disposed) {
          return;
        }

        const mapped = payload
          .map((incident) => mapApiIncident(incident))
          .filter((incident): incident is IncidentRow => Boolean(incident));

        setLiveIncidents(mapped);
      } catch {
        // Ignore API fetch failures in local fallback mode.
      }
    };

    void loadIncidents();
    const timer = window.setInterval(() => {
      void loadIncidents();
    }, 10_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const loadChecks = async (): Promise<void> => {
      try {
        const response = await fetch(checksApiUrl, {
          headers: {
            "x-tenant-id": demoTenantId
          }
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as ApiCheck[];
        if (disposed) {
          return;
        }

        setLiveChecks(payload);
      } catch {
        // Keep existing values on fetch failures.
      }
    };

    void loadChecks();
    const timer = window.setInterval(() => {
      void loadChecks();
    }, 30_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const columns = columnCountForRange(range);
  const heatmapColumns = heatmapColumnCountForRange(range);

  const checkNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const check of liveChecks) {
      map.set(check.id, check.name);
    }
    return map;
  }, [liveChecks]);

  const checkRows = useMemo(() => {
    if (heatmapRows.length > 0) {
      return heatmapRows;
    }

    // Fallback: expand live checks into region rows when heatmap is unavailable.
    const rows: CheckRow[] = [];
    for (const check of liveChecks) {
      const checkRegions = Array.isArray(check.regions) && check.regions.length > 0 ? check.regions : regions;
      for (const region of checkRegions) {
        rows.push({
          id: `${check.id}-${region}`,
          checkId: check.id,
          service: check.name,
          checkName: `${check.name} / ${region}`,
          region,
          statuses: Array.from({ length: heatmapColumns }, () => "no-data" as HealthState),
          totals: Array.from({ length: heatmapColumns }, () => 0),
          p95: 0,
          errorRate: 0,
          uptime24h: 100,
          customerAffected: 0,
          group: inferServiceGroup(check.name, check.tags),
          sampleCount: 0
        });
      }
    }

    return rows.length > 0 ? rows : generateCheckRows(columns);
  }, [columns, heatmapColumns, heatmapRows, liveChecks]);

  const filteredRows = useMemo(() => {
    let rows = [...checkRows].filter((row) => {
      if (isNoiseCheckName(row.service) || isNoiseCheckName(row.checkName)) {
        return false;
      }
      // Hide configured-but-silent region rows (eu-west/ap-south with no probes yet).
      return row.sampleCount > 0 || row.statuses.some((state) => state !== "no-data");
    });

    if (selectedRegion !== "all") {
      rows = rows.filter((row) => row.region === selectedRegion);
    }

    if (serviceGroup !== "all") {
      rows = rows.filter((row) => row.group === serviceGroup);
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      rows = rows.filter((row) => row.checkName.toLowerCase().includes(q) || row.service.toLowerCase().includes(q));
    }

    if (heatSort === "name") {
      rows.sort((a, b) => a.checkName.localeCompare(b.checkName));
    } else if (heatSort === "region") {
      rows.sort((a, b) => a.region.localeCompare(b.region));
    } else {
      rows.sort((a, b) => {
        const aw = Math.max(...a.statuses.map(stateWeight));
        const bw = Math.max(...b.statuses.map(stateWeight));
        if (aw !== bw) return bw - aw;
        if (b.errorRate !== a.errorRate) return b.errorRate - a.errorRate;
        return b.sampleCount - a.sampleCount;
      });
    }

    return rows;
  }, [checkRows, searchText, selectedRegion, serviceGroup, heatSort]);

  const timeWindowMs = useMemo(() => {
    if (range === "1h") return 60 * 60_000;
    if (range === "24h") return 24 * 60 * 60_000;
    if (range === "7d") return 7 * 24 * 60 * 60_000;
    if (range === "30d") return 30 * 24 * 60 * 60_000;
    return 24 * 60 * 60_000;
  }, [range]);

  const scopedRegions = useMemo(() => {
    if (selectedRegion !== "all") {
      return [selectedRegion];
    }

    const withSamples = regionalSummary
      .filter((row) => row.sampleCount > 0)
      .map((row) => row.region);

    return withSamples.length > 0 ? withSamples : regions;
  }, [regionalSummary, selectedRegion]);

  const selectedCanonicalRegion = useMemo(() => {
    return selectedRegion === "all" ? null : normalizeRegion(selectedRegion);
  }, [selectedRegion]);

  const scopedCheckIds = useMemo(() => {
    if (liveChecks.length === 0) {
      return null;
    }

    const ids = new Set<string>();
    for (const check of liveChecks) {
      if (!matchesEnvironment(check.tags, environment)) {
        continue;
      }
      const checkRegions = Array.isArray(check.regions) ? check.regions : [];
      const regionPass = !selectedCanonicalRegion
        ? true
        : checkRegions.some((region) => normalizeRegion(region) === selectedCanonicalRegion);
      const groupPass = serviceGroup === "all" ? true : inferServiceGroup(check.name, check.tags) === serviceGroup;
      if (regionPass && groupPass) {
        ids.add(check.id);
      }
    }

    return ids;
  }, [liveChecks, selectedCanonicalRegion, serviceGroup, environment]);

  const selectedRangeLabel = useMemo(() => {
    const match = rangeOptions.find((option) => option.key === range);
    return match ? match.label : "Selected window";
  }, [range]);

  useEffect(() => {
    let disposed = false;

    const loadMetrics = async (): Promise<void> => {
      const rangeKey = range === "custom" ? "24h" : range;
      const headers = { "x-tenant-id": demoTenantId };

      try {
        const latencyUrl = new URL(latencySeriesApiUrl);
        latencyUrl.searchParams.set("range", rangeKey);
        latencyUrl.searchParams.set("region", selectedRegion);
        latencyUrl.searchParams.set("serviceGroup", serviceGroup);
        latencyUrl.searchParams.set("environment", environment);
        latencyUrl.searchParams.set("points", String(columns));

        const summaryUrl = new URL(metricsSummaryApiUrl);
        summaryUrl.searchParams.set("range", rangeKey);
        summaryUrl.searchParams.set("region", selectedRegion);
        summaryUrl.searchParams.set("serviceGroup", serviceGroup);
        summaryUrl.searchParams.set("environment", environment);

        const heatmapUrl = new URL(heatmapApiUrl);
        heatmapUrl.searchParams.set("range", rangeKey);
        heatmapUrl.searchParams.set("region", selectedRegion);
        heatmapUrl.searchParams.set("serviceGroup", serviceGroup);
        heatmapUrl.searchParams.set("environment", environment);
        heatmapUrl.searchParams.set("points", String(heatmapColumns));

        const regionalUrl = new URL(regionalApiUrl);
        regionalUrl.searchParams.set("range", rangeKey);
        regionalUrl.searchParams.set("serviceGroup", serviceGroup);
        regionalUrl.searchParams.set("environment", environment);

        const [latencyRes, summaryRes, heatmapRes, regionalRes] = await Promise.all([
          fetch(latencyUrl.toString(), { headers }),
          fetch(summaryUrl.toString(), { headers }),
          fetch(heatmapUrl.toString(), { headers }),
          fetch(regionalUrl.toString(), { headers })
        ]);

        if (!disposed && latencyRes.ok) {
          const payload = (await latencyRes.json()) as LatencySeriesResponse;
          if (hasSeriesSignal(payload)) {
            setApiLatencySeries(payload);
            setLatencySeriesSource("timescale");
          } else {
            setApiLatencySeries(null);
            setLatencySeriesSource("stream");
          }
        } else if (!disposed) {
          setApiLatencySeries(null);
          setLatencySeriesSource("stream");
        }

        if (!disposed && summaryRes.ok) {
          setMetricsSummary((await summaryRes.json()) as MetricsSummaryResponse);
        }

        if (!disposed && heatmapRes.ok) {
          const payload = (await heatmapRes.json()) as HeatmapResponse;
          setHeatmapBuckets(payload.buckets ?? []);
          setHeatmapRows(
            (payload.rows ?? []).map((row) => ({
              id: `${row.checkId}-${row.region}`,
              checkId: row.checkId,
              service: row.checkName,
              checkName: `${row.checkName} / ${row.region}`,
              region: row.region,
              statuses: row.statuses,
              totals: row.totals ?? row.statuses.map(() => 0),
              p95: row.p95,
              errorRate: row.errorRate,
              uptime24h: row.uptimePct,
              customerAffected: 0,
              group: inferServiceGroup(row.checkName),
              sampleCount: row.sampleCount
            }))
          );
        }

        if (!disposed && regionalRes.ok) {
          setRegionalSummary((await regionalRes.json()) as RegionalSummaryRow[]);
        }
      } catch {
        if (!disposed) {
          setApiLatencySeries(null);
          setLatencySeriesSource("stream");
        }
      }
    };

    void loadMetrics();

    if (!live) {
      return () => {
        disposed = true;
      };
    }

    const timer = window.setInterval(() => {
      void loadMetrics();
    }, 15_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [columns, heatmapColumns, live, range, selectedRegion, serviceGroup, environment]);

  useEffect(() => {
    let disposed = false;

    const loadNotifiers = async (): Promise<void> => {
      try {
        const response = await fetch(notifiersApiUrl, {
          headers: { "x-tenant-id": demoTenantId }
        });
        if (!response.ok || disposed) {
          return;
        }
        setNotifiers((await response.json()) as Array<{ id: string; type: string; url: string; name: string }>);
      } catch {
        // Keep existing notifiers on failure.
      }
    };

    void loadNotifiers();
    return () => {
      disposed = true;
    };
  }, []);

  const createNotifier = async (): Promise<void> => {
    setNotifierMessage(null);
    try {
      const response = await fetch(notifiersApiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": demoTenantId
        },
        body: JSON.stringify({
          type: notifierType,
          url: notifierUrl,
          name: notifierType === "slack" ? "Slack alerts" : "Webhook alerts"
        })
      });
      if (!response.ok) {
        setNotifierMessage(`Failed: ${await response.text()}`);
        return;
      }
      setNotifierUrl("");
      setNotifierMessage(`${notifierType} notifier saved`);
      const list = await fetch(notifiersApiUrl, { headers: { "x-tenant-id": demoTenantId } });
      if (list.ok) {
        setNotifiers((await list.json()) as Array<{ id: string; type: string; url: string; name: string }>);
      }
    } catch (error) {
      const hint =
        error instanceof TypeError
          ? "Cannot reach API (use http://localhost:3005, not 127.0.0.1, and ensure the stack is running)"
          : error instanceof Error
            ? error.message
            : "Failed to save notifier";
      setNotifierMessage(hint);
    }
  };

  const testNotifier = async (id: string): Promise<void> => {
    setNotifierMessage(null);
    try {
      const response = await fetch(`${notifiersApiUrl}/${id}/test`, {
        method: "POST",
        headers: { "x-tenant-id": demoTenantId }
      });
      if (!response.ok) {
        setNotifierMessage(`Test failed: ${await response.text()}`);
        return;
      }
      setNotifierMessage("Test alert sent");
    } catch (error) {
      setNotifierMessage(error instanceof Error ? error.message : "Test failed");
    }
  };

  const recentProbeEvents = useMemo(() => {
    const now = Date.now();
    const filtered = activeProbeEvents
      .filter((event) => {
        const at = new Date(event.receivedAt).getTime();
        if (Number.isNaN(at)) {
          return false;
        }
        if (now - at > timeWindowMs) {
          return false;
        }
        if (selectedRegion !== "all") {
          const selected = normalizeRegion(selectedRegion);
          const sample = normalizeRegion(event.sample.region);
          if (!selected || !sample || selected !== sample) {
            return false;
          }
        }
        if (scopedCheckIds && !scopedCheckIds.has(event.sample.checkId)) {
          return false;
        }
        return true;
      });

    return filtered.length > 25_000 ? filtered.slice(filtered.length - 25_000) : filtered;
  }, [activeProbeEvents, scopedCheckIds, selectedRegion, timeWindowMs]);

  const allRecentProbeEvents = useMemo(() => {
    const now = Date.now();
    const filtered = activeProbeEvents
      .filter((event) => {
        const at = new Date(event.receivedAt).getTime();
        if (Number.isNaN(at)) {
          return false;
        }
        if (now - at > timeWindowMs) {
          return false;
        }
        if (scopedCheckIds && !scopedCheckIds.has(event.sample.checkId)) {
          return false;
        }
        return true;
      });

    return filtered.length > 40_000 ? filtered.slice(filtered.length - 40_000) : filtered;
  }, [activeProbeEvents, scopedCheckIds, timeWindowMs]);

  const liveIncomingProbeEvents = useMemo(() => {
    const now = Date.now();
    const liveWindowMs = 5 * 60_000;
    const filtered = activeProbeEvents.filter((event) => {
      const at = new Date(event.receivedAt).getTime();
      if (Number.isNaN(at)) {
        return false;
      }
      if (now - at > liveWindowMs) {
        return false;
      }
      if (selectedRegion !== "all") {
        const selected = normalizeRegion(selectedRegion);
        const sample = normalizeRegion(event.sample.region);
        if (!selected || !sample || selected !== sample) {
          return false;
        }
      }
      if (scopedCheckIds && !scopedCheckIds.has(event.sample.checkId)) {
        return false;
      }
      return true;
    });

    return filtered.length > 10_000 ? filtered.slice(filtered.length - 10_000) : filtered;
  }, [activeProbeEvents, scopedCheckIds, selectedRegion]);

  const scopedIncidents = useMemo(() => {
    return liveIncidents.filter((incident) => {
      if (!incident.checkId) {
        return selectedRegion === "all" && serviceGroup === "all";
      }

      if (!scopedCheckIds) {
        return true;
      }

      return scopedCheckIds.has(incident.checkId);
    });
  }, [liveIncidents, scopedCheckIds, selectedRegion, serviceGroup]);

  const liveHealthMix = useMemo(() => {
    const success = recentProbeEvents.filter((event) => event.sample.ok).length;
    const failed = recentProbeEvents.length - success;
    return {
      success,
      failed,
      total: Math.max(1, recentProbeEvents.length)
    };
  }, [recentProbeEvents]);

  const liveLatencyStats = useMemo(() => {
    return calculateLatencyStats(recentProbeEvents);
  }, [recentProbeEvents]);

  const liveIncomingStats = useMemo(() => {
    return calculateLatencyStats(liveIncomingProbeEvents);
  }, [liveIncomingProbeEvents]);

  const summary = useMemo(() => {
    const servicesMonitored = scopedCheckIds ? scopedCheckIds.size : filteredRows.length;
    const openIncidents = scopedIncidents;
    const customersAffected = openIncidents.reduce((acc, incident) => acc + incident.affectedChecks * 220, 0);

    return {
      servicesMonitored,
      openIncidents,
      customersAffected
    };
  }, [filteredRows, scopedCheckIds, scopedIncidents]);

  const regionRows = useMemo(() => {
    if (regionalSummary.length > 0) {
      return scopedRegions.map((region) => {
        const match = regionalSummary.find((row) => normalizeRegion(row.region) === normalizeRegion(region));
        const p95Value = match?.p95 ?? 0;
        const err = match ? match.errorRatePct.toFixed(1) : "0.0";
        const uptime = match ? match.uptimePct.toFixed(2) : "0.00";
        const checks = match?.checks ?? filteredRows.filter((row) => row.region === region).length;
        const trend = makeSeries(6, 80 + region.length * 6, 16, 0);

        return {
          region,
          checks,
          uptime,
          p95Value,
          err,
          trend,
          health: p95Value > 700 || Number(err) > 2.8 ? "down" : p95Value > 280 ? "degraded" : match && match.sampleCount === 0 ? "no-data" : "healthy"
        } as const;
      });
    }

    return scopedRegions.map((region) => {
      const rows = filteredRows.filter((row) => row.region === region);
      const checks = rows.length;
      const uptime = checks
        ? (rows.reduce((acc, row) => acc + row.uptime24h, 0) / checks).toFixed(2)
        : "0.00";
      const p95Value = checks ? Math.round(rows.reduce((acc, row) => acc + row.p95, 0) / checks) : 0;
      const err = checks
        ? (rows.reduce((acc, row) => acc + row.errorRate, 0) / checks).toFixed(1)
        : "0.0";
      const trend = makeSeries(6, 80 + region.length * 6, 16, 0);

      return {
        region,
        checks,
        uptime,
        p95Value,
        err,
        trend,
        health: p95Value > 700 || Number(err) > 2.8 ? "down" : p95Value > 280 ? "degraded" : "healthy"
      } as const;
    });
  }, [filteredRows, regionalSummary, scopedRegions]);

  const incidentSourceMix = useMemo(() => {
    const counts = {
      pulse: scopedIncidents.filter((incident) => incident.source === "pulse").length,
      confirmed: scopedIncidents.filter((incident) => incident.source === "confirmed").length,
      reported: scopedIncidents.filter((incident) => incident.source === "reported").length
    };

    const total = Math.max(1, counts.pulse + counts.confirmed + counts.reported);
    return { counts, total };
  }, [scopedIncidents]);

  const latencyDistribution = useMemo(() => {
    const hasLiveSamples = allRecentProbeEvents.length > 0;

    return scopedRegions
      .map((region) => {
        const normalizedRegion = normalizeRegion(region);
        const scopedLive = allRecentProbeEvents.filter((event) => {
          const sampleRegion = normalizeRegion(event.sample.region);
          return normalizedRegion && sampleRegion && normalizedRegion === sampleRegion;
        });

        let fast = scopedLive.filter((event) => event.sample.latencyMs < 250).length;
        let medium = scopedLive.filter((event) => event.sample.latencyMs >= 250 && event.sample.latencyMs < 450).length;
        let slow = scopedLive.filter((event) => event.sample.latencyMs >= 450).length;

        if (!hasLiveSamples) {
          const scopedFallback = filteredRows.filter((check) => check.region === region);
          const regional = regionalSummary.find((row) => normalizeRegion(row.region) === normalizedRegion);
          if (regional && regional.sampleCount > 0) {
            // Approximate mix from regional summary when SSE window is empty.
            fast = regional.p95 < 250 ? regional.sampleCount : 0;
            medium = regional.p95 >= 250 && regional.p95 < 450 ? regional.sampleCount : 0;
            slow = regional.p95 >= 450 ? regional.sampleCount : 0;
          } else {
            fast = scopedFallback.filter((check) => check.p95 < 250 && check.sampleCount > 0).length;
            medium = scopedFallback.filter((check) => check.p95 >= 250 && check.p95 < 450 && check.sampleCount > 0).length;
            slow = scopedFallback.filter((check) => check.p95 >= 450 && check.sampleCount > 0).length;
          }
        }

        const totalRaw = fast + medium + slow;
        const totalForPct = Math.max(1, totalRaw);

        return {
          region,
          fast,
          medium,
          slow,
          total: totalRaw,
          fastPct: Math.round((fast / totalForPct) * 100),
          mediumPct: Math.round((medium / totalForPct) * 100),
          slowPct: Math.round((slow / totalForPct) * 100)
        };
      })
      .filter((item) => selectedRegion !== "all" || item.total > 0);
  }, [allRecentProbeEvents, filteredRows, regionalSummary, scopedRegions, selectedRegion]);

  const latencySeries = useMemo(() => {
    const bucketMs = Math.max(1, Math.floor(timeWindowMs / Math.max(1, columns)));
    const now = Date.now();
    const buckets: number[][] = Array.from({ length: columns }, () => []);

    for (const event of recentProbeEvents) {
      const at = new Date(event.receivedAt).getTime();
      if (Number.isNaN(at)) {
        continue;
      }

      const age = now - at;
      if (age < 0 || age > timeWindowMs) {
        continue;
      }

      const reverseIndex = Math.floor(age / bucketMs);
      const index = columns - 1 - reverseIndex;
      if (index < 0 || index >= columns) {
        continue;
      }

      buckets[index].push(event.sample.latencyMs);
    }

    const percentileFor = (values: number[], p: number): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
      return Math.round(sorted[idx]);
    };

    const p50Series: Array<number | null> = [];
    const p95Series: Array<number | null> = [];
    const p99Series: Array<number | null> = [];

    for (const bucket of buckets) {
      if (bucket.length === 0) {
        p50Series.push(null);
        p95Series.push(null);
        p99Series.push(null);
        continue;
      }

      p50Series.push(percentileFor(bucket, 0.5));
      p95Series.push(percentileFor(bucket, 0.95));
      p99Series.push(percentileFor(bucket, 0.99));
    }

    return {
      p50: p50Series,
      p95: p95Series,
      p99: p99Series
    };
  }, [columns, recentProbeEvents, timeWindowMs]);

  const regionalActivitySeries = useMemo(() => {
    return regionRows.map((row, seriesIndex) => {
      const values = Array.from({ length: 12 }, (_, index) => {
        const baseline = row.p95Value / 20 + Number(row.err) * 7;
        const wave = Math.sin((index + seriesIndex) / 1.8) * 9;
        const burst = index % 4 === 0 ? 8 : 0;
        return Math.max(6, Math.min(96, Math.round(baseline + wave + burst)));
      });

      return {
        region: row.region,
        values
      };
    });
  }, [regionRows]);

  const noisyChecks = useMemo(() => {
    return filteredRows
      .map((row) => ({
        id: row.id,
        checkName: row.checkName,
        p95: row.p95,
        errorRate: row.errorRate,
        score: Math.round(row.errorRate * 100 + row.p95 / 3)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [filteredRows]);

  const sloRows = useMemo(() => {
    const groups: Array<{ name: string; group: ServiceGroup; target: number }> = [
      { name: "GitHub availability", group: "github", target: 99.5 },
      { name: "Stripe availability", group: "stripe", target: 99.9 },
      { name: "Baseline probes", group: "baseline", target: 99.0 },
      { name: "Cloudflare availability", group: "cloudflare", target: 99.5 }
    ];

    return groups.map((item) => {
      const rows = checkRows.filter((row) => row.group === item.group && row.sampleCount > 0);
      const totalSamples = rows.reduce((acc, row) => acc + row.sampleCount, 0);
      const weightedUptime = totalSamples > 0
        ? rows.reduce((acc, row) => acc + row.uptime24h * row.sampleCount, 0) / totalSamples
        : 100;
      const errorRatio = Math.max(0, (100 - weightedUptime) / 100);
      const budgetRatio = Math.max(0.0001, (100 - item.target) / 100);
      const remaining = Math.max(0, Math.min(100, Math.round(((budgetRatio - errorRatio) / budgetRatio) * 100)));
      const burn = errorRatio / budgetRatio;
      const windowDays = range === "30d" ? 30 : range === "7d" ? 7 : 1;
      const allowedDowntimeMin = budgetRatio * windowDays * 24 * 60;
      const remainingMin = Math.max(0, allowedDowntimeMin * (remaining / 100));
      const downtimeLeft = remainingMin >= 60
        ? `${Math.floor(remainingMin / 60)}h ${Math.round(remainingMin % 60)}m`
        : `${Math.round(remainingMin)}m`;

      return {
        name: item.name,
        target: `${item.target}%`,
        window: selectedRangeLabel.replace("Last ", ""),
        remaining,
        burn: `${burn.toFixed(1)}x`,
        downtimeLeft
      };
    });
  }, [checkRows, range, selectedRangeLabel]);

  const heatmapLabels = useMemo(() => {
    if (heatmapBuckets.length === 0) {
      return [];
    }

    const showEvery = range === "1h" ? 2 : range === "24h" ? 3 : range === "7d" ? 6 : 5;
    return heatmapBuckets.map((bucket, index) => {
      if (index % showEvery !== 0 && index !== heatmapBuckets.length - 1) {
        return "";
      }
      return formatBucketLabel(bucket, range);
    });
  }, [heatmapBuckets, range]);

  const labels = useMemo(() => {
    const sourceBuckets = hasSeriesSignal(apiLatencySeries)
      ? apiLatencySeries?.buckets ?? []
      : [];

    const showEvery =
      range === "1h" ? 2
        : range === "24h" ? 4
          : range === "7d" ? 7
            : 5;

    const fromBuckets = (buckets: string[]): string[] =>
      buckets.map((bucket, index) => {
        if (index !== 0 && index !== buckets.length - 1 && index % showEvery !== 0) {
          return "";
        }
        return formatBucketLabel(bucket, range);
      });

    if (sourceBuckets.length === columns) {
      return fromBuckets(sourceBuckets);
    }

    if (clockMs == null) {
      return Array.from({ length: columns }, () => "");
    }

    return Array.from({ length: columns }, (_, index) => {
      if (index !== 0 && index !== columns - 1 && index % showEvery !== 0) {
        return "";
      }
      const ageMs = ((columns - 1 - index) / Math.max(1, columns - 1)) * timeWindowMs;
      return formatBucketLabel(new Date(clockMs - ageMs).toISOString(), range);
    });
  }, [apiLatencySeries, clockMs, columns, range, timeWindowMs]);

  const activePoint = Math.min(columns - 1, Math.max(0, hoveredPoint ?? columns - 1));
  const chartWidth = 920;
  const chartHeight = 290;
  const plotLeft = 52;
  const plotRight = 12;
  const plotWidth = chartWidth - plotLeft - plotRight;
  const showAllDots = columns <= 48;

  const chartLatencySeries = useMemo(() => {
    if (hasSeriesSignal(apiLatencySeries) && apiLatencySeries && apiLatencySeries.p95.length === columns) {
      return {
        p50: apiLatencySeries.p50,
        p95: apiLatencySeries.p95,
        p99: apiLatencySeries.p99,
        sampleCount: apiLatencySeries.sampleCount,
        source: "timescale" as const
      };
    }

    const streamHasSignal = latencySeries.p95.some((value) => value != null && value > 0);
    if (streamHasSignal) {
      return {
        p50: latencySeries.p50,
        p95: latencySeries.p95,
        p99: latencySeries.p99,
        sampleCount: recentProbeEvents.length,
        source: "stream" as const
      };
    }

    return {
      p50: Array.from({ length: columns }, () => null as number | null),
      p95: Array.from({ length: columns }, () => null as number | null),
      p99: Array.from({ length: columns }, () => null as number | null),
      sampleCount: metricsSummary?.sampleCount ?? 0,
      source: "empty" as const
    };
  }, [apiLatencySeries, columns, latencySeries.p50, latencySeries.p95, latencySeries.p99, metricsSummary?.sampleCount, recentProbeEvents.length]);

  useEffect(() => {
    setLatencySeriesSource(chartLatencySeries.source);
  }, [chartLatencySeries.source]);

  const displaySeries = [
    { key: "p50", label: "p50", color: "#6B7280", values: chartLatencySeries.p50, drawn: forwardFillSeries(chartLatencySeries.p50) },
    { key: "p95", label: "p95", color: "#2563EB", values: chartLatencySeries.p95, drawn: forwardFillSeries(chartLatencySeries.p95) },
    { key: "p99", label: "p99", color: "#D97706", values: chartLatencySeries.p99, drawn: forwardFillSeries(chartLatencySeries.p99) }
  ] as const;

  const maxValue = robustLatencyMax(chartLatencySeries);
  const minValue = 0;

  const scaleY = (value: number): number => {
    const clamped = Math.min(value, maxValue);
    const span = Math.max(1, maxValue - minValue);
    return chartHeight - ((clamped - minValue) / span) * chartHeight;
  };

  const scaleX = (index: number): number => {
    return plotLeft + (index / Math.max(1, columns - 1)) * plotWidth;
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: chartHeight * ratio,
    value: Math.round(maxValue * (1 - ratio))
  }));

  const activeBucketLabel = useMemo(() => {
    const fromApi = hasSeriesSignal(apiLatencySeries) ? apiLatencySeries?.buckets?.[activePoint] : undefined;
    if (fromApi) {
      return formatBucketLabel(fromApi, range);
    }
    return labels[activePoint] || "bucket";
  }, [activePoint, apiLatencySeries, labels, range]);

  const liveLatencySamples = chartLatencySeries.sampleCount;

  const latencyNarrative = useMemo(() => {
    const defined = chartLatencySeries.p95.filter((value): value is number => value != null);
    const currentP95 = defined[defined.length - 1] ?? metricsSummary?.p95 ?? 0;
    const startP95 = defined[0] ?? currentP95;
    const changePct = startP95 > 0 ? Math.round(((currentP95 - startP95) / startP95) * 100) : 0;

    let status = defined.length === 0 ? "No data" : "Stable";
    let meaning = defined.length === 0
      ? "No latency samples in this window yet."
      : "User experience is within expected bounds.";

    if (defined.length > 0 && (currentP95 >= 900 || changePct >= 35)) {
      status = "Critical";
      meaning = "Users are likely seeing noticeable slowness and timeouts.";
    } else if (defined.length > 0 && (currentP95 >= 450 || changePct >= 15)) {
      status = "At risk";
      meaning = "Users may feel slow screens, especially during peak traffic.";
    }

    return {
      status,
      meaning,
      currentP95,
      changePct
    };
  }, [chartLatencySeries.p95, metricsSummary?.p95]);

  const sourcePieStyle = useMemo(() => {
    const pulsePct = Math.round((incidentSourceMix.counts.pulse / incidentSourceMix.total) * 100);
    const confirmedPct = Math.round((incidentSourceMix.counts.confirmed / incidentSourceMix.total) * 100);
    const reportedPct = Math.max(0, 100 - pulsePct - confirmedPct);

    return {
      background: `conic-gradient(var(--status-degraded) 0 ${pulsePct}%, var(--status-down) ${pulsePct}% ${pulsePct + confirmedPct}%, var(--accent-blue) ${pulsePct + confirmedPct}% ${pulsePct + confirmedPct + reportedPct}%)`
    };
  }, [incidentSourceMix.counts.confirmed, incidentSourceMix.counts.pulse, incidentSourceMix.total]);

  const healthPieStyle = useMemo(() => {
    const okPct = Math.round((liveHealthMix.success / liveHealthMix.total) * 100);
    const failPct = Math.max(0, 100 - okPct);

    return {
      background: `conic-gradient(var(--status-healthy) 0 ${okPct}%, var(--status-down) ${okPct}% ${okPct + failPct}%)`
    };
  }, [liveHealthMix.success, liveHealthMix.total]);

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <section className="sticky top-0 z-20 mb-3 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
        <div className="flex h-auto min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2 text-[14px]">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="mono text-[15px] font-semibold lowercase text-[var(--text-primary)]">pulse</span>
            <span
              className="inline-flex items-center gap-1 text-[var(--text-muted)]"
              title="Organization / tenant slug for this demo workspace"
            >
              {tenant}
            </span>
            <div className="flex items-center gap-1 sm:ml-2">
              {(["production", "staging", "development"] as const).map((env) => (
                <button
                  key={env}
                  type="button"
                  onClick={() => setEnvironment(env)}
                  className={`px-2 py-1 text-[13px] ${
                    environment === env
                      ? "border-b-2 border-[var(--accent-blue)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {env}
                </button>
              ))}
            </div>
          </div>

          <div className="flex max-w-full flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] px-2 py-1 text-[12px] text-[var(--text-muted)]">
              Region
              <select
                value={selectedRegion}
                onChange={(event) => setSelectedRegion(event.target.value)}
                className="rounded border border-[var(--border-color)] bg-[var(--card-bg)] px-1 py-0.5 text-[12px] text-[var(--text-primary)] outline-none"
              >
                <option value="all">All regions</option>
                {regions.map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] px-2 py-1 text-[12px] text-[var(--text-muted)]">
              Hours
              <select
                value={range}
                onChange={(event) => setRange(event.target.value as RangeKey)}
                className="rounded border border-[var(--border-color)] bg-[var(--card-bg)] px-1 py-0.5 text-[12px] text-[var(--text-primary)] outline-none"
              >
                <option value="1h">Last 1 hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => setLive((value) => !value)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-1 text-[12px] text-[var(--text-muted)]"
            >
              <span className={`h-2 w-2 rounded-full ${live ? "bg-[var(--status-healthy)]" : "bg-[var(--text-muted)]"}`} />
              {live ? "Live" : "Paused"}
            </button>

            <label className="inline-flex min-w-0 items-center rounded-md border border-[var(--border-color)] px-2 py-1 text-[12px] text-[var(--text-muted)]">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search checks"
                className="w-28 border-0 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] sm:w-40"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <div className="mb-2 text-xs text-[var(--text-muted)]">
          Tenant <span className="mono text-[var(--text-primary)]">{tenant}</span>
          {" · "}
          Env <span className="mono text-[var(--text-primary)]">{environment}</span>
          {" · "}
          Region <span className="mono text-[var(--text-primary)]">{selectedRegion === "all" ? "all regions" : selectedRegion}</span>
        </div>
        {environment !== "production" ? (
          <p className="mb-2 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Showing checks tagged <span className="mono text-[var(--text-primary)]">env:{environment}</span>.
            {scopedCheckIds && scopedCheckIds.size === 0
              ? " No checks in this environment yet — restart scheduler to seed staging/dev targets, or switch back to production."
              : ` ${scopedCheckIds?.size ?? 0} checks in scope.`}
          </p>
        ) : null}
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Story: <span className="text-[var(--text-primary)]">Now</span> (overview) {"->"} <span className="text-[var(--text-primary)]">Trend</span> (latency + uptime) {"->"} <span className="text-[var(--text-primary)]">Cause</span> (source mix + noisiest checks) {"->"} <span className="text-[var(--text-primary)]">Where</span> (regional breakdown).
        </p>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">1. Current posture</h2>
        <p className="mb-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Live incoming (last 5m) · Historical window {selectedRangeLabel.toLowerCase()}
          {metricsSummary ? ` · ${metricsSummary.sampleCount.toLocaleString()} samples` : ""}
        </p>
        <div className="mb-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <article className="panel-card h-24 p-3">
            <p className="kpi-label">Services monitored</p>
            <p className="mono kpi-value">{summary.servicesMonitored}</p>
            <p className="kpi-delta text-[var(--text-muted)]">live from checks API</p>
          </article>
          <article className="panel-card h-24 p-3">
            <p className="kpi-label">Live samples</p>
            <p className="mono kpi-value">{liveIncomingStats.sampleCount}</p>
            <p className="kpi-delta text-[var(--text-muted)]">SSE events in last 5m</p>
          </article>
          <article className="panel-card h-24 p-3">
            <p className="kpi-label">Window uptime</p>
            <p className="mono kpi-value">{(metricsSummary?.uptimePct ?? liveIncomingStats.uptimePct).toFixed(2)}%</p>
            <p className="kpi-delta text-[var(--text-muted)]">{metricsSummary ? "Timescale summary" : "SSE based (last 5m)"}</p>
          </article>
          <article className="panel-card h-24 p-3">
            <p className="kpi-label">Window p95 latency</p>
            <p className="mono kpi-value">{metricsSummary?.p95 ?? liveIncomingStats.p95} ms</p>
            <p className="kpi-delta text-[var(--text-muted)]">{metricsSummary ? "Timescale summary" : "SSE based (last 5m)"}</p>
          </article>
          <article className="panel-card h-24 p-3">
            <p className="kpi-label">Open incidents</p>
            <p className="mono kpi-value inline-flex items-center gap-2">
              {summary.openIncidents.length}
              {summary.openIncidents.some((item) => item.severity === "SEV-1") && (
                <span className="h-2 w-2 rounded-full bg-[var(--status-down)]" />
              )}
            </p>
            <p className="kpi-delta text-[var(--text-muted)]">live from incidents API</p>
          </article>
          <article className="panel-card h-24 p-3">
            <p className="kpi-label">Window error rate</p>
            <p className="mono kpi-value">{(metricsSummary?.errorRatePct ?? liveIncomingStats.errorRatePct).toFixed(2)}%</p>
            <p className="kpi-delta text-[var(--text-muted)]">{metricsSummary ? "Timescale summary" : "SSE based (last 5m)"}</p>
          </article>
        </div>

      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-8">
          <article className="panel-card order-1 p-5">
            <header className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">2. Trend · Latency trend</h3>
                <p className="text-xs text-[var(--text-muted)]">p50 · p95 · p99 for selected region and time window</p>
              </div>
              <div className="inline-flex flex-wrap items-center justify-end gap-2 text-xs text-[var(--text-muted)]">
                <span className="mono">samples {liveLatencySamples.toLocaleString()}</span>
                <span className="mono">source {latencySeriesSource}</span>
                <span className="mono">{columns} buckets</span>
              </div>
            </header>

            <div className="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-xs text-[var(--text-primary)]">
              <p className="font-semibold">Latency health: {latencyNarrative.status}</p>
              <p className="text-[var(--text-muted)]">{latencyNarrative.meaning}</p>
              <p className="mono mt-1 text-[var(--text-muted)]">p95 now {latencyNarrative.currentP95}ms · change {latencyNarrative.changePct >= 0 ? "+" : ""}{latencyNarrative.changePct}% in {selectedRangeLabel.toLowerCase()}</p>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {([
                ["all", `All services (${liveChecks.length || checkRows.length})`],
                ["github", "GitHub"],
                ["openai", "OpenAI"],
                ["stripe", "Stripe"],
                ["cloudflare", "Cloudflare"],
                ["baseline", "Baseline"],
                ["other", "Other"]
              ] as const).map(([groupKey, label]) => (
                <button
                  key={groupKey}
                  type="button"
                  onClick={() => setServiceGroup(groupKey)}
                  className={`chip ${serviceGroup === groupKey ? "chip-active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative rounded-md border border-[var(--border-color)] p-3">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="h-[300px] w-full"
                role="img"
                aria-label="Latency over time"
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
                  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
                  const plotStart = (plotLeft / chartWidth) * rect.width;
                  const plotEnd = ((plotLeft + plotWidth) / chartWidth) * rect.width;
                  const clampedX = Math.max(plotStart, Math.min(plotEnd, x));
                  const index = Math.round(((clampedX - plotStart) / Math.max(1, plotEnd - plotStart)) * (columns - 1));
                  setHoveredPoint(index);
                  setLatencyHoverPosition({ x, y });
                }}
                onMouseLeave={() => {
                  setHoveredPoint(null);
                  setLatencyHoverPosition(null);
                }}
              >
                {yTicks.map((tick) => (
                  <g key={`tick-${tick.y}`}>
                    <line
                      x1={plotLeft}
                      x2={chartWidth - plotRight}
                      y1={tick.y}
                      y2={tick.y}
                      stroke="var(--border-subtle)"
                      strokeDasharray="2 4"
                    />
                    <text
                      x={plotLeft - 8}
                      y={tick.y === 0 ? 12 : tick.y === chartHeight ? chartHeight - 2 : tick.y + 4}
                      textAnchor="end"
                      fontSize="11"
                      fill="#94A3B8"
                    >
                      {tick.value}
                    </text>
                  </g>
                ))}

                {displaySeries.map((series) => {
                  const path = toChartPath(series.drawn, scaleX, scaleY);
                  if (!path) {
                    return null;
                  }

                  return (
                    <path
                      key={series.key}
                      d={path}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={range === "30d" || range === "7d" ? 2 : 2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}

                {displaySeries.map((series) =>
                  series.values.map((value, index) => {
                    if (value == null) {
                      return null;
                    }
                    if (!showAllDots && index !== activePoint) {
                      return null;
                    }
                    return (
                      <circle
                        key={`dot-${series.key}-${index}`}
                        cx={scaleX(index)}
                        cy={scaleY(value)}
                        r={index === activePoint ? 4 : 2.2}
                        fill={series.color}
                        stroke="#fff"
                        strokeWidth="1"
                      />
                    );
                  })
                )}

                <line
                  x1={scaleX(activePoint)}
                  x2={scaleX(activePoint)}
                  y1="0"
                  y2={chartHeight}
                  stroke="#475569"
                  strokeDasharray="2 3"
                />
              </svg>

              <div className="relative mt-2 h-5 text-[11px] text-[var(--text-muted)]" style={{ marginLeft: `${(plotLeft / chartWidth) * 100}%`, marginRight: `${(plotRight / chartWidth) * 100}%` }}>
                {labels.map((label, index) => {
                  if (!label) {
                    return null;
                  }
                  return (
                    <span
                      key={`label-${index}`}
                      className={`mono absolute top-0 -translate-x-1/2 whitespace-nowrap ${index === activePoint ? "text-[var(--text-primary)]" : ""}`}
                      style={{ left: `${(index / Math.max(1, columns - 1)) * 100}%` }}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>

              {latencyHoverPosition ? (
                <div
                  className="pointer-events-none absolute z-10 w-44 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] p-2 text-xs shadow-[0_6px_16px_rgb(0_0_0_/_0.16)]"
                  style={{
                    left: `${Math.min(Math.max(latencyHoverPosition.x + 18, 56), 720)}px`,
                    top: `${Math.min(Math.max(latencyHoverPosition.y + 28, 16), 220)}px`
                  }}
                >
                  <p className="mono mb-1 text-[var(--text-primary)]">{activeBucketLabel}</p>
                  <p className="mono text-[var(--text-muted)]">p50 {chartLatencySeries.p50[activePoint] ?? "—"}{chartLatencySeries.p50[activePoint] != null ? "ms" : ""}</p>
                  <p className="mono text-[var(--text-muted)]">p95 {chartLatencySeries.p95[activePoint] ?? "—"}{chartLatencySeries.p95[activePoint] != null ? "ms" : ""}</p>
                  <p className="mono text-[var(--text-muted)]">
                    p99{" "}
                    {chartLatencySeries.p99[activePoint] == null
                      ? "—"
                      : (chartLatencySeries.p99[activePoint] as number) > maxValue
                        ? `${Math.round(maxValue)}ms+`
                        : `${chartLatencySeries.p99[activePoint]}ms`}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#6B7280]" />p50</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#2563EB]" />p95</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#D97706]" />p99</span>
              <span className="ml-auto mono text-[11px]">
                {chartLatencySeries.source === "empty" ? "No samples in this window" : "Hover chart to inspect values"}
              </span>
            </div>
          </article>

          <article className="panel-card order-2 p-5">
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">2. Trend · Uptime by check</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Each row is a live check/region. Cells are time buckets for {selectedRangeLabel.toLowerCase()}. Gray = no samples in that bucket.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={heatSort}
                  onChange={(event) => setHeatSort(event.target.value as HeatSort)}
                  className="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-primary)]"
                >
                  <option value="worst">worst first</option>
                  <option value="name">name</option>
                  <option value="region">region</option>
                </select>
                <button type="button" className="panel-menu">...</button>
              </div>
            </header>

            <div className="max-h-[430px] overflow-auto rounded-md border border-[var(--border-color)]" data-heatmap="true">
              {filteredRows.length === 0 ? (
                <p className="px-3 py-6 text-sm text-[var(--text-muted)]">No check samples in this window yet.</p>
              ) : (
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[220px_1fr] items-center border-b border-[var(--border-subtle)] px-3 py-1">
                    <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">Check</p>
                    <div className="flex w-full justify-between text-[10px] text-[var(--text-muted)]">
                      {heatmapLabels.map((label, index) => (
                        <span key={`heat-axis-${index}`} className="mono min-w-0 flex-1 text-center">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  {filteredRows.slice(0, 40).map((row) => {
                    const current = lastKnownStatus(row.statuses);
                    const cellCount = Math.max(row.statuses.length, heatmapBuckets.length || heatmapColumns);
                    const statuses = Array.from({ length: cellCount }, (_, index) => row.statuses[index] ?? "no-data");
                    const totals = Array.from({ length: cellCount }, (_, index) => row.totals?.[index] ?? 0);

                    return (
                      <div key={row.id} className="grid grid-cols-[220px_1fr] items-center border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0">
                        <div className="pr-3">
                          <p className="truncate text-xs font-medium text-[var(--text-primary)]" title={row.checkName}>
                            {row.service}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1">
                            <span className={`h-2 w-2 rounded-full ${statusColorClass(current)}`} />
                            {row.region} · {statusWord(current)} · {row.uptime24h.toFixed(1)}%
                          </p>
                        </div>
                        <div className="flex h-4 w-full gap-[2px]">
                          {statuses.map((state, index) => {
                            const bucketIso = heatmapBuckets[index];
                            const bucketLabel = bucketIso
                              ? formatBucketLabel(bucketIso, range) || heatmapLabels[index] || `bucket ${index + 1}`
                              : heatmapLabels[index] || `bucket ${index + 1}`;
                            const samples = totals[index] ?? 0;

                            return (
                              <span
                                key={`${row.id}-${index}`}
                                className={`${statusColorClass(state)} min-w-0 flex-1 rounded-[1px] ${state === "no-data" ? "opacity-35" : ""}`}
                                title={`${bucketLabel} · ${statusWord(state)} · ${samples} samples`}
                                onMouseEnter={() => {
                                  setHeatHover({
                                    checkName: row.service,
                                    region: row.region,
                                    status: state,
                                    bucketLabel,
                                    samples
                                  });
                                }}
                                onMouseLeave={() => setHeatHover(null)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-muted)]">
              {heatHover ? (
                <p>
                  <span className="mono text-[var(--text-primary)]">{heatHover.bucketLabel}</span>
                  {" · "}{heatHover.checkName} · {heatHover.region} · {statusWord(heatHover.status)}
                  {" · "}{heatHover.samples} samples
                </p>
              ) : (
                <p>
                  {heatmapBuckets.length > 0
                    ? `${heatmapBuckets.length} buckets loaded from Timescale · hover a cell for samples`
                    : "Waiting for heatmap buckets from /metrics/heatmap…"}
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-[var(--status-healthy)]" />healthy</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-[var(--status-degraded)]" />degraded</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-[var(--status-down)]" />down</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-[var(--status-nodata)] opacity-50" />no data</span>
            </div>
          </article>

          <article className="panel-card order-4 p-5">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">4. Regional impact · Regional breakdown</h3>
              <button type="button" className="panel-menu">...</button>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                      <th className="py-2">Region</th>
                      <th className="py-2 text-right">Checks</th>
                      <th className="py-2 text-right">Uptime 24h</th>
                      <th className="py-2 text-right">p95</th>
                      <th className="py-2 text-right">Error rate</th>
                      <th className="py-2 text-right">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionRows.map((row) => {
                      const trendPath = toSparkPath(row.trend, 60, 12);
                      return (
                        <tr
                          key={row.region}
                          className={`table-row-hover border-b border-[var(--border-subtle)] text-[var(--text-primary)] ${
                            selectedRegion === row.region ? "table-row-selected" : ""
                          }`}
                        >
                          <td className="py-2">
                            <button type="button" onClick={() => setSelectedRegion(row.region)} className="text-left hover:underline">
                              {row.region}
                            </button>
                          </td>
                          <td className="mono py-2 text-right">{row.checks}</td>
                          <td className="mono py-2 text-right">{row.uptime}%</td>
                          <td className="mono py-2 text-right">{row.p95Value} ms</td>
                          <td className="mono py-2 text-right">{row.err}%</td>
                          <td className="py-2 text-right">
                            <svg viewBox="0 0 60 12" className="inline-block h-3 w-[60px]">
                              <path d={trendPath} fill="none" stroke="#64748B" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border border-[var(--border-color)] p-3">
                <svg viewBox="0 0 360 190" className="h-[190px] w-full" role="img" aria-label="World map by region">
                  <rect x="0" y="0" width="360" height="190" fill="#F8FAFC" />
                  <path d="M26 55 L102 40 L145 62 L124 102 L58 112 L22 86 Z" fill="#E5E7EB" stroke="#D1D5DB" strokeWidth="1" />
                  <path d="M138 76 L178 58 L228 68 L252 100 L222 120 L162 116 Z" fill="#E5E7EB" stroke="#D1D5DB" strokeWidth="1" />
                  <path d="M212 118 L246 106 L280 116 L296 144 L272 168 L232 162 L214 134 Z" fill="#E5E7EB" stroke="#D1D5DB" strokeWidth="1" />

                  {regionRows.map((row) => {
                    const point =
                      row.region === "us-east"
                        ? { x: 95, y: 72 }
                        : row.region === "eu-west"
                          ? { x: 176, y: 77 }
                          : { x: 244, y: 120 };
                    const fill = row.health === "down" ? "#DC2626" : row.health === "degraded" ? "#D97706" : row.health === "no-data" ? "#94A3B8" : "#16A34A";
                    const active = selectedRegion === row.region;

                    return (
                      <g key={row.region} onClick={() => setSelectedRegion(row.region)} className="cursor-pointer">
                        <circle cx={point.x} cy={point.y} r={active ? 8 : 6} fill={fill} opacity={0.9} />
                        <circle cx={point.x} cy={point.y} r={active ? 14 : 11} fill="none" stroke={fill} strokeOpacity={0.38} />
                        <text x={point.x + 11} y={point.y + 4} fontSize="10" fill="#334155">
                          {row.region}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <button type="button" className="text-[var(--accent-blue)] hover:underline" onClick={() => setSelectedRegion("all")}>All regions</button>
                  <span>click a region to filter</span>
                </div>
              </div>
            </div>
          </article>

          <article className="panel-card order-3 p-5">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">3. Cause analysis · Reliability composition</h3>
              <button type="button" className="panel-menu">...</button>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-[var(--border-color)] p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Incident source mix</p>
                <div className="h-5 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]">
                  <div className="flex h-full w-full">
                    <span
                      className="h-full bg-[var(--status-degraded)]"
                      style={{ width: `${Math.round((incidentSourceMix.counts.pulse / incidentSourceMix.total) * 100)}%` }}
                    />
                    <span
                      className="h-full bg-[var(--status-down)]"
                      style={{ width: `${Math.round((incidentSourceMix.counts.confirmed / incidentSourceMix.total) * 100)}%` }}
                    />
                    <span
                      className="h-full bg-[var(--accent-blue)]"
                      style={{ width: `${Math.round((incidentSourceMix.counts.reported / incidentSourceMix.total) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-xs text-[var(--text-primary)]">
                  <p className="mono">Pulse: {incidentSourceMix.counts.pulse}</p>
                  <p className="mono">Confirmed: {incidentSourceMix.counts.confirmed}</p>
                  <p className="mono">Reported-only: {incidentSourceMix.counts.reported}</p>
                </div>
              </div>

              <div className="rounded-md border border-[var(--border-color)] p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Latency distribution by region</p>
                <div className="space-y-3">
                  {latencyDistribution.map((item) => (
                    <div key={item.region}>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--text-primary)]">
                        <span className="mono">{item.region}</span>
                        <span className="mono">{item.total} samples</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]">
                        <div className="flex h-full w-full">
                          <span className="h-full bg-[var(--status-healthy)]" style={{ width: `${item.fastPct}%` }} />
                          <span className="h-full bg-[var(--status-degraded)]" style={{ width: `${item.mediumPct}%` }} />
                          <span className="h-full bg-[var(--status-down)]" style={{ width: `${item.slowPct}%` }} />
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                        fast {item.fast} · medium {item.medium} · slow {item.slow}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="panel-card order-5 p-5">
            <header className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-semibold text-[var(--text-primary)]">2. Trend · SLO status</h3>
                <a href="#" className="text-xs text-[var(--accent-blue)] hover:underline">Configure SLOs →</a>
              </div>
              <button type="button" className="panel-menu">...</button>
            </header>

            <div className="space-y-4">
              {sloRows.map((row) => {
                const consumed = 100 - row.remaining;
                const redTick = Math.min(100, consumed + 18);
                return (
                  <div key={row.name} className="border-b border-[var(--border-subtle)] pb-3 last:border-b-0 last:pb-0">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{row.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">Target {row.target} · {row.window}</p>
                    </div>
                    <div className="relative h-1.5 w-full overflow-hidden rounded-sm bg-[#E5E7EB]">
                      <div className="h-1.5 bg-[var(--status-healthy)]" style={{ width: `${consumed}%` }} />
                      <span className="absolute top-0 h-1.5 w-[2px] bg-[var(--status-down)]" style={{ left: `${redTick}%` }} />
                    </div>
                    <p className="mono mt-1 text-xs text-[var(--text-primary)]">{row.remaining}% budget left · burn {row.burn} (fast)</p>
                    <p className="mono text-xs text-[var(--text-muted)]">{row.downtimeLeft} of allowed downtime remaining</p>
                  </div>
                );
              })}
            </div>
          </article>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <LiveProbePanel
            regionFilter={selectedRegion}
            paused={!live}
            searchText={searchText}
            checkNames={Object.fromEntries(checkNameById)}
          />

          <article className="panel-card p-5">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Open incidents</h3>
              <a href="#" className="text-xs text-[var(--accent-blue)] hover:underline">View all →</a>
            </header>

            {summary.openIncidents.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No open incidents. Last incident resolved 6h ago.</p>
            ) : (
              <div className="max-h-80 space-y-3 overflow-auto pr-1">
                {summary.openIncidents.map((incident) => {
                  const stroke =
                    incident.severity === "SEV-1"
                      ? "#DC2626"
                      : incident.severity === "SEV-2"
                        ? "#D97706"
                        : "#CA8A04";
                  const sparkPath = toSparkPath(incident.spark, 100, 18);
                  const markX = (incident.startIndex / Math.max(1, incident.spark.length - 1)) * 100;

                  return (
                    <article key={incident.id} className="rounded-md border border-[var(--border-color)] border-l-2 bg-[var(--card-bg)] p-3" style={{ borderLeftColor: stroke }}>
                      <p className="mb-1 text-sm text-[var(--text-primary)]">
                        <span className="mr-2 inline-block rounded-sm border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-semibold">{incident.severity}</span>
                        <span className={`mr-2 inline-block rounded-sm border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-semibold ${sourceChipClass(incident.source)}`}>Source {sourceChip(incident.source)}</span>
                        <span className="font-semibold">{incident.title}</span>
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">Opened {incident.openedAgo} · {incident.affectedChecks} checks affected · {incident.affectedRegions} regions</p>
                      <p className="text-xs text-[var(--text-muted)]">Acknowledged by {incident.acknowledgedBy} · {incident.state}</p>
                      {incident.correlationMessage ? (
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{incident.correlationMessage}</p>
                      ) : null}
                      <svg viewBox="0 0 100 18" className="mt-2 h-[18px] w-[100px]">
                        <path d={sparkPath} fill="none" stroke="#6B7280" strokeWidth="1.2" />
                        <line x1={markX} x2={markX} y1="0" y2="18" stroke="#DC2626" strokeDasharray="2 2" />
                      </svg>
                    </article>
                  );
                })}
              </div>
            )}
          </article>

          <article className="panel-card p-5">
            <header className="mb-3 flex items-center justify-between">
              <div className="inline-flex rounded-md border border-[var(--border-color)] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setActivityTab("alerts")}
                  className={`rounded-sm px-2 py-1 ${activityTab === "alerts" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"}`}
                >
                  Alerts
                </button>
                <button
                  type="button"
                  onClick={() => setActivityTab("oncall")}
                  className={`rounded-sm px-2 py-1 ${activityTab === "oncall" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"}`}
                >
                  On-call
                </button>
                <button
                  type="button"
                  onClick={() => setActivityTab("activity")}
                  className={`rounded-sm px-2 py-1 ${activityTab === "activity" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"}`}
                >
                  Activity
                </button>
              </div>
            </header>

            {activityTab === "alerts" ? (
              <div className="space-y-3 text-sm text-[var(--text-primary)]">
                <p className="text-xs text-[var(--text-muted)]">
                  Slack and webhook notifiers fire when the alerter opens an incident. Set <span className="mono">SLACK_WEBHOOK_URL</span> / <span className="mono">ALERT_WEBHOOK_URL</span> or add one below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={notifierType}
                    onChange={(event) => setNotifierType(event.target.value as "slack" | "webhook")}
                    className="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs"
                  >
                    <option value="slack">Slack</option>
                    <option value="webhook">Webhook</option>
                  </select>
                  <input
                    value={notifierUrl}
                    onChange={(event) => setNotifierUrl(event.target.value)}
                    placeholder={notifierType === "slack" ? "https://hooks.slack.com/services/..." : "https://example.com/hook"}
                    className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] px-2 py-1 text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void createNotifier()}
                    className="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[#F8FAFC]"
                  >
                    Add
                  </button>
                </div>
                {notifierMessage ? <p className="text-xs text-[var(--text-muted)]">{notifierMessage}</p> : null}
                <div className="max-h-40 space-y-2 overflow-auto">
                  {notifiers.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No notifiers configured yet.</p>
                  ) : (
                    notifiers.map((notifier) => (
                      <div key={notifier.id} className="rounded-md border border-[var(--border-color)] px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium">{notifier.name || notifier.type}</p>
                          <button
                            type="button"
                            onClick={() => void testNotifier(notifier.id)}
                            className="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px]"
                          >
                            Test
                          </button>
                        </div>
                        <p className="mono truncate text-[10px] text-[var(--text-muted)]">{notifier.type} · {notifier.url}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : activityTab === "oncall" ? (
              <div className="space-y-2 text-sm text-[var(--text-primary)]">
                <p>Primary: Priya Shah · until 18:00 IST</p>
                <p>Secondary: Marcus Lee · until 18:00 PT</p>
                <p>Escalation: platform-oncall (PagerDuty)</p>
              </div>
            ) : (
              <div className="max-h-52 overflow-auto text-sm">
                {activityRows.map((row) => (
                  <p key={row} className="border-b border-[var(--border-subtle)] py-1 text-[var(--text-primary)] last:border-b-0">
                    <span className="text-[var(--text-muted)]">{row.split(" · ")[0]}</span>
                    <span> · {row.split(" · ")[1]}</span>
                  </p>
                ))}
              </div>
            )}
          </article>

          <article className="panel-card p-5">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Regional activity pulse</h3>
              <span className="text-[11px] text-[var(--text-muted)]">last 60m</span>
            </header>

            <div className="space-y-3">
              {regionalActivitySeries.map((series) => (
                <div key={series.region}>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--text-primary)]">
                    <span className="mono">{series.region}</span>
                    <span className="mono text-[var(--text-muted)]">12 slices</span>
                  </div>
                  <div className="grid grid-cols-12 gap-1">
                    {series.values.map((value, index) => (
                      <span
                        key={`${series.region}-${index}`}
                        className="rounded-sm bg-[var(--accent-blue)]/70"
                        style={{ height: `${Math.max(6, Math.round(value / 4))}px` }}
                        title={`${series.region} slice ${index + 1}: load ${value}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel-card p-5">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Noisiest checks</h3>
              <span className="text-[11px] text-[var(--text-muted)]">error + latency</span>
            </header>

            <div className="space-y-2">
              {noisyChecks.map((check) => {
                const width = Math.max(10, Math.min(100, Math.round(check.score / 8)));
                return (
                  <div key={check.id} className="rounded-md border border-[var(--border-color)] p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-[var(--text-primary)]">{check.checkName}</p>
                      <p className="mono text-[11px] text-[var(--text-muted)]">score {check.score}</p>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]">
                      <div
                        className="h-full bg-[var(--status-down)]"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">p95 {check.p95}ms · err {check.errorRate}%</p>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="panel-card p-5">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Live mix pies</h3>
              <span className="text-[11px] text-[var(--text-muted)]">source and health</span>
            </header>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border border-[var(--border-color)] p-3">
                <p className="mb-2 text-[11px] font-semibold text-[var(--text-muted)]">Incident sources</p>
                <div className="mx-auto h-24 w-24 rounded-full" style={sourcePieStyle} />
                <div className="mt-3 space-y-1 text-[10px] text-[var(--text-primary)]">
                  <p>Pulse {incidentSourceMix.counts.pulse}</p>
                  <p>Confirmed {incidentSourceMix.counts.confirmed}</p>
                  <p>Reported {incidentSourceMix.counts.reported}</p>
                </div>
              </div>

              <div className="rounded-md border border-[var(--border-color)] p-3">
                <p className="mb-2 text-[11px] font-semibold text-[var(--text-muted)]">Probe health</p>
                <div className="mx-auto h-24 w-24 rounded-full" style={healthPieStyle} />
                <div className="mt-3 space-y-1 text-[10px] text-[var(--text-primary)]">
                  <p>Healthy {liveHealthMix.success}</p>
                  <p>Failed {liveHealthMix.failed}</p>
                  <p>Window samples {recentProbeEvents.length}</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
