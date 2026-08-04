/**
 * Single base URL for Vercel / production.
 * Individual NEXT_PUBLIC_*_URL overrides still work for local debugging.
 */
const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

function resolveUrl(explicit: string | undefined, path: string): string {
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }
  return `${apiBase}${path}`;
}

export const apiConfig = {
  baseUrl: apiBase,
  checks: resolveUrl(process.env.NEXT_PUBLIC_CHECKS_API_URL, "/checks"),
  incidents: resolveUrl(process.env.NEXT_PUBLIC_INCIDENTS_API_URL, "/incidents"),
  sse: resolveUrl(process.env.NEXT_PUBLIC_API_SSE_URL, "/live/probes"),
  latencySeries: resolveUrl(process.env.NEXT_PUBLIC_LATENCY_SERIES_API_URL, "/metrics/latency-series"),
  metricsSummary: resolveUrl(process.env.NEXT_PUBLIC_METRICS_SUMMARY_API_URL, "/metrics/summary"),
  heatmap: resolveUrl(process.env.NEXT_PUBLIC_HEATMAP_API_URL, "/metrics/heatmap"),
  regional: resolveUrl(process.env.NEXT_PUBLIC_REGIONAL_API_URL, "/metrics/regional"),
  notifiers: resolveUrl(process.env.NEXT_PUBLIC_NOTIFIERS_API_URL, "/notifiers")
} as const;
