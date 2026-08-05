/**
 * Local benchmarks for Pulse.
 *
 * - Always runs in-process microbenchmarks (alert fingerprint + SLO + sample JSON).
 * - If the API is reachable, also measures control-plane latency and 24h sample volume.
 *
 * Usage:
 *   pnpm bench
 *   node benchmarks/local-bench.mjs --api http://localhost:3000
 */
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const outPath = join(repoRoot, "docs", "benchmark-results.json");

const apiArgIndex = process.argv.indexOf("--api");
const apiBase =
  apiArgIndex >= 0 ? process.argv[apiArgIndex + 1] : process.env.PULSE_API_URL ?? "http://localhost:3000";
const tenantId = process.env.PULSE_TENANT_ID ?? "11111111-1111-1111-1111-111111111111";

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    avgMs: Number((sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)).toFixed(3)),
    p50Ms: Number(pct(sorted, 0.5).toFixed(3)),
    p95Ms: Number(pct(sorted, 0.95).toFixed(3)),
    p99Ms: Number(pct(sorted, 0.99).toFixed(3))
  };
}

function bench(name, iterations, fn) {
  for (let i = 0; i < Math.min(200, iterations); i += 1) fn(i);
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(i);
  const elapsedMs = performance.now() - started;
  const opsPerSec = Math.round((iterations / elapsedMs) * 1000);
  return { name, iterations, elapsedMs: Number(elapsedMs.toFixed(2)), opsPerSec };
}

function evaluateAlert(input) {
  const fingerprint = createHash("sha256")
    .update(`${input.checkId}:${input.vendorTag ?? "none"}:${input.error ?? input.statusCode}`)
    .digest("hex");
  return { shouldAlert: !input.ok, fingerprint };
}

function evaluateSlo(input) {
  const availability = input.totalProbes === 0 ? 1 : input.successfulProbes / input.totalProbes;
  const errorRatio = 1 - availability;
  const errorBudgetRatio = 1 - input.target;
  const burnRate = errorRatio / errorBudgetRatio;
  return { availability, burnRate, compliant: availability >= input.target };
}

async function measureApiLatency(path, requests = 50, concurrency = 10) {
  const latencies = [];
  let failures = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < requests) {
      cursor += 1;
      const started = performance.now();
      try {
        const response = await fetch(`${apiBase}${path}`, {
          headers: { "x-tenant-id": tenantId }
        });
        if (!response.ok) failures += 1;
        await response.arrayBuffer();
      } catch {
        failures += 1;
      }
      latencies.push(performance.now() - started);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { ...summarize(latencies), failures, concurrency, path };
}

async function fetchJson(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "x-tenant-id": tenantId }
  });
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const generatedAt = new Date().toISOString();
  const checkId = randomUUID();

  const microbenchmarks = [
    bench("alert_fingerprint_sha256", 50_000, (i) =>
      evaluateAlert({
        checkId,
        vendorTag: i % 2 === 0 ? "github" : null,
        ok: i % 17 !== 0,
        error: i % 17 === 0 ? "HTTP assertion failed" : null,
        statusCode: i % 17 === 0 ? 500 : 200
      })
    ),
    bench("slo_burn_rate_eval", 100_000, (i) =>
      evaluateSlo({
        successfulProbes: 9_900 + (i % 50),
        totalProbes: 10_000,
        target: 0.999
      })
    ),
    bench("json_sample_parse_roundtrip", 20_000, (i) => {
      const payload = {
        time: new Date().toISOString(),
        checkId,
        region: ["us-east", "eu-west", "ap-south"][i % 3],
        ok: true,
        latencyMs: 10 + (i % 90),
        statusCode: 200,
        error: null,
        sizeBytes: 256,
        assertionFailures: []
      };
      return JSON.parse(JSON.stringify(payload));
    })
  ];

  let live = null;
  try {
    const health = await fetchJson("/health");
    if (health?.status !== "ok") {
      throw new Error("health not ok");
    }

    const [healthLatency, metricsLatency, summary, regional] = await Promise.all([
      measureApiLatency("/health", 80, 20),
      measureApiLatency("/metrics/summary?range=24h&region=all&serviceGroup=all", 40, 10),
      fetchJson("/metrics/summary?range=24h&region=all&serviceGroup=all"),
      fetchJson("/metrics/regional?range=24h&environment=all")
    ]);

    const regionsWithSamples = (Array.isArray(regional) ? regional : []).filter(
      (row) => Number(row.sampleCount) > 0
    );

    live = {
      apiBase,
      healthLatency,
      metricsLatency,
      sampleVolume24h: Number(summary.sampleCount ?? 0),
      uptimePct24h: Number(summary.uptimePct ?? 0),
      p95LatencyMs24h: Number(summary.p95 ?? 0),
      regionsActive: regionsWithSamples.length,
      regionalBreakdown: regionsWithSamples.map((row) => ({
        region: row.region,
        sampleCount: Number(row.sampleCount),
        p95: Number(row.p95),
        uptimePct: Number(row.uptimePct)
      }))
    };
  } catch (error) {
    live = {
      apiBase,
      unavailable: true,
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  const report = {
    generatedAt,
    machine: {
      platform: process.platform,
      node: process.version
    },
    unitTests: {
      note: "Run separately via pnpm test:unit",
      packages: ["@pulse/core", "@pulse/contracts"]
    },
    microbenchmarks,
    live
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
