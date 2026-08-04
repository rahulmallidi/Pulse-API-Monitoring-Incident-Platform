import { Injectable } from "@nestjs/common";
import { timescalePool } from "@pulse/db";

type RangeKey = "1h" | "24h" | "7d" | "30d";
type ServiceGroup = "all" | "payments" | "auth" | "search" | "cart" | "other" | "github" | "openai" | "stripe" | "cloudflare" | "baseline";
type HealthState = "healthy" | "degraded" | "down" | "no-data";

type SummaryRow = {
  total: string | number;
  ok_total: string | number;
  p50_latency_ms: string | number | null;
  p95_latency_ms: string | number | null;
  p99_latency_ms: string | number | null;
};

type LatencyRow = {
  bucket: Date;
  total: string | number;
  p50_latency_ms: string | number | null;
  p95_latency_ms: string | number | null;
  p99_latency_ms: string | number | null;
};

type HeatBucketRow = {
  check_id: string;
  check_name: string;
  region: string;
  bucket: Date;
  total: string | number;
  ok_total: string | number;
  p95_latency_ms: string | number | null;
};

type RegionalRow = {
  region: string;
  total: string | number;
  ok_total: string | number;
  p95_latency_ms: string | number | null;
  check_count: string | number;
};

@Injectable()
export class MetricsService {
  async getHistoricalSummary(params: {
    tenantId: string;
    range: RangeKey;
    region: string;
    serviceGroup: ServiceGroup;
    environment: string;
  }): Promise<{
    sampleCount: number;
    uptimePct: number;
    errorRatePct: number;
    p50: number;
    p95: number;
    p99: number;
  }> {
    const intervalText = this.toInterval(params.range);
    const region = this.normalizeRegionFilter(params.region);
    const environment = this.normalizeEnvironment(params.environment);

    const result = await timescalePool.query<SummaryRow>(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN s.ok THEN 1 ELSE 0 END), 0) AS ok_total,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p50_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p95_latency_ms,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p99_latency_ms
      FROM samples s
      INNER JOIN checks c ON c.id = s.check_id
      WHERE c.tenant_id = $1::uuid
        AND c.enabled = true
        AND lower(c.name) NOT LIKE '%smoke%'
        AND lower(c.name) NOT LIKE 'failing check%'
        AND lower(c.name) NOT LIKE '%pulse demo%'
        AND s.time >= NOW() - ($2::text)::interval
        AND ($3::text = 'all' OR lower(s.region) = lower($3::text))
        AND (${this.serviceGroupSql("$4")})
        AND (${this.environmentSql("$5")})
      `,
      [params.tenantId, intervalText, region, params.serviceGroup, environment]
    );

    const row = result.rows[0];
    const total = Number(row?.total ?? 0);
    const okTotal = Number(row?.ok_total ?? 0);
    const uptimePct = total > 0 ? Number(((okTotal / total) * 100).toFixed(2)) : 100;
    const errorRatePct = Number((100 - uptimePct).toFixed(2));

    return {
      sampleCount: total,
      uptimePct,
      errorRatePct,
      p50: Math.round(Number(row?.p50_latency_ms ?? 0)),
      p95: Math.round(Number(row?.p95_latency_ms ?? 0)),
      p99: Math.round(Number(row?.p99_latency_ms ?? 0))
    };
  }

  async getLatencySeries(params: {
    tenantId: string;
    range: RangeKey;
    region: string;
    serviceGroup: ServiceGroup;
    points: number;
    environment: string;
  }): Promise<{
    points: number;
    sampleCount: number;
    buckets: string[];
    p50: Array<number | null>;
    p95: Array<number | null>;
    p99: Array<number | null>;
  }> {
    const points = Math.min(240, Math.max(6, params.points));
    const rangeMinutes = this.toRangeMinutes(params.range);
    const bucketMinutes = Math.max(1, Math.floor(rangeMinutes / points));
    const intervalText = this.toInterval(params.range);
    const region = this.normalizeRegionFilter(params.region);
    const environment = this.normalizeEnvironment(params.environment);

    const result = await timescalePool.query<LatencyRow>(
      `
      WITH params AS (
        SELECT
          ($5::text || ' minutes')::interval AS bucket_width,
          NOW() - ($2::text)::interval AS window_start,
          NOW() AS window_end
      ),
      bounds AS (
        SELECT
          time_bucket((SELECT bucket_width FROM params), (SELECT window_start FROM params)) AS start_bucket,
          time_bucket((SELECT bucket_width FROM params), (SELECT window_end FROM params)) AS end_bucket,
          (SELECT bucket_width FROM params) AS bucket_width
      ),
      buckets AS (
        SELECT generate_series(
          (SELECT start_bucket FROM bounds),
          (SELECT end_bucket FROM bounds),
          (SELECT bucket_width FROM bounds)
        ) AS bucket
      ),
      agg AS (
        SELECT
          time_bucket((SELECT bucket_width FROM bounds), s.time) AS bucket,
          COUNT(*) AS total,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p50_latency_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p95_latency_ms,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p99_latency_ms
        FROM samples s
        INNER JOIN checks c ON c.id = s.check_id
        WHERE c.tenant_id = $1::uuid
          AND c.enabled = true
          AND lower(c.name) NOT LIKE '%smoke%'
          AND lower(c.name) NOT LIKE 'failing check%'
          AND lower(c.name) NOT LIKE '%pulse demo%'
          AND s.time >= (SELECT window_start FROM params)
          AND ($3::text = 'all' OR lower(s.region) = lower($3::text))
          AND (${this.serviceGroupSql("$4")})
          AND (${this.environmentSql("$6")})
        GROUP BY 1
      )
      SELECT
        b.bucket,
        COALESCE(a.total, 0) AS total,
        a.p50_latency_ms,
        a.p95_latency_ms,
        a.p99_latency_ms
      FROM buckets b
      LEFT JOIN agg a ON a.bucket = b.bucket
      ORDER BY b.bucket ASC
      `,
      [params.tenantId, intervalText, region, params.serviceGroup, String(bucketMinutes), environment]
    );

    // Prefer the trailing `points` buckets so the chart ends at "now".
    const rows = result.rows.slice(Math.max(0, result.rows.length - points));
    let sampleCount = 0;
    const buckets: string[] = [];
    const p50: Array<number | null> = [];
    const p95: Array<number | null> = [];
    const p99: Array<number | null> = [];

    for (const row of rows) {
      const total = Number(row.total ?? 0);
      sampleCount += total;
      buckets.push(new Date(row.bucket).toISOString());

      if (total <= 0 || row.p95_latency_ms == null) {
        p50.push(null);
        p95.push(null);
        p99.push(null);
        continue;
      }

      p50.push(Math.round(Number(row.p50_latency_ms ?? 0)));
      p95.push(Math.round(Number(row.p95_latency_ms ?? 0)));
      p99.push(Math.round(Number(row.p99_latency_ms ?? 0)));
    }

    while (buckets.length < points) {
      buckets.unshift("");
      p50.unshift(null);
      p95.unshift(null);
      p99.unshift(null);
    }

    return {
      points: buckets.length,
      sampleCount,
      buckets,
      p50,
      p95,
      p99
    };
  }

  async getHeatmap(params: {
    tenantId: string;
    range: RangeKey;
    region: string;
    serviceGroup: ServiceGroup;
    points: number;
    environment: string;
  }): Promise<{
    points: number;
    buckets: string[];
    rows: Array<{
      checkId: string;
      checkName: string;
      region: string;
      statuses: HealthState[];
      totals: number[];
      p95: number;
      errorRate: number;
      uptimePct: number;
      sampleCount: number;
    }>;
  }> {
    const points = Math.min(240, Math.max(6, params.points));
    const rangeMinutes = this.toRangeMinutes(params.range);
    const bucketMinutes = Math.max(1, Math.floor(rangeMinutes / points));
    const region = this.normalizeRegionFilter(params.region);
    const environment = this.normalizeEnvironment(params.environment);

    const result = await timescalePool.query<HeatBucketRow & { check_id: string; check_name: string }>(
      `
      WITH params AS (
        SELECT
          ($4::text || ' minutes')::interval AS bucket_width,
          time_bucket(($4::text || ' minutes')::interval, NOW()) AS end_bucket,
          $5::int AS point_count
      ),
      buckets AS (
        SELECT generate_series(
          (SELECT end_bucket FROM params)
            - (((SELECT point_count FROM params) - 1) * (SELECT bucket_width FROM params)),
          (SELECT end_bucket FROM params),
          (SELECT bucket_width FROM params)
        ) AS bucket
      ),
      window_start AS (
        SELECT (SELECT MIN(bucket) FROM buckets) AS start_bucket
      ),
      scoped_checks AS (
        SELECT
          c.id AS check_id,
          c.name AS check_name,
          r.region AS region
        FROM checks c
        CROSS JOIN LATERAL unnest(c.regions) AS r(region)
        WHERE c.tenant_id = $1::uuid
          AND c.enabled = true
          AND lower(c.name) NOT LIKE '%smoke%'
          AND lower(c.name) NOT LIKE 'failing check%'
          AND lower(c.name) NOT LIKE '%pulse demo%'
          AND ($2::text = 'all' OR lower(r.region) = lower($2::text))
          AND (${this.serviceGroupSql("$3")})
          AND (${this.environmentSql("$6")})
          AND EXISTS (
            SELECT 1
            FROM samples s
            WHERE s.check_id = c.id
              AND lower(s.region) = lower(r.region)
              AND s.time >= (SELECT start_bucket FROM window_start)
          )
      ),
      grid AS (
        SELECT
          sc.check_id,
          sc.check_name,
          sc.region,
          b.bucket
        FROM scoped_checks sc
        CROSS JOIN buckets b
      ),
      agg AS (
        SELECT
          s.check_id,
          s.region,
          time_bucket((SELECT bucket_width FROM params), s.time) AS bucket,
          COUNT(*)::int AS total,
          SUM(CASE WHEN s.ok THEN 1 ELSE 0 END)::int AS ok_total,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p95_latency_ms
        FROM samples s
        INNER JOIN checks c ON c.id = s.check_id
        WHERE c.tenant_id = $1::uuid
          AND c.enabled = true
          AND lower(c.name) NOT LIKE '%smoke%'
          AND lower(c.name) NOT LIKE 'failing check%'
          AND lower(c.name) NOT LIKE '%pulse demo%'
          AND s.time >= (SELECT start_bucket FROM window_start)
          AND ($2::text = 'all' OR lower(s.region) = lower($2::text))
          AND (${this.serviceGroupSql("$3")})
          AND (${this.environmentSql("$6")})
        GROUP BY s.check_id, s.region, bucket
      )
      SELECT
        g.check_id,
        g.check_name,
        g.region,
        g.bucket,
        COALESCE(a.total, 0) AS total,
        COALESCE(a.ok_total, 0) AS ok_total,
        a.p95_latency_ms
      FROM grid g
      LEFT JOIN agg a
        ON a.check_id = g.check_id
       AND lower(a.region) = lower(g.region)
       AND a.bucket = g.bucket
      ORDER BY g.check_name ASC, g.region ASC, g.bucket ASC
      `,
      [params.tenantId, region, params.serviceGroup, String(bucketMinutes), points, environment]
    );

    type Acc = {
      checkId: string;
      checkName: string;
      region: string;
      statuses: HealthState[];
      totals: number[];
      oks: number[];
      p95Sum: number;
      p95Count: number;
      sampleCount: number;
      bucketKeys: string[];
    };

    const byKey = new Map<string, Acc>();
    const bucketOrder: string[] = [];

    for (const row of result.rows) {
      const bucketIso = new Date(row.bucket).toISOString();
      if (!bucketOrder.includes(bucketIso)) {
        bucketOrder.push(bucketIso);
      }

      const key = `${row.check_id}:${row.region}`;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          checkId: row.check_id,
          checkName: row.check_name,
          region: row.region,
          statuses: [],
          totals: [],
          oks: [],
          p95Sum: 0,
          p95Count: 0,
          sampleCount: 0,
          bucketKeys: []
        };
        byKey.set(key, acc);
      }

      const total = Number(row.total ?? 0);
      const okTotal = Number(row.ok_total ?? 0);
      acc.bucketKeys.push(bucketIso);
      acc.totals.push(total);
      acc.oks.push(okTotal);
      acc.sampleCount += total;
      acc.statuses.push(this.toHealthState(total, okTotal, Number(row.p95_latency_ms ?? 0)));

      if (total > 0 && row.p95_latency_ms != null) {
        acc.p95Sum += Number(row.p95_latency_ms);
        acc.p95Count += 1;
      }
    }

    const buckets = bucketOrder.length > 0
      ? bucketOrder
      : Array.from({ length: points }, () => "");

    const rows = [...byKey.values()]
      .map((acc) => {
        // Normalize to shared bucket timeline in case of any ordering skew.
        const statusByBucket = new Map(acc.bucketKeys.map((key, index) => [key, {
          status: acc.statuses[index],
          total: acc.totals[index],
          ok: acc.oks[index]
        }]));

        const statuses = buckets.map((bucket) => statusByBucket.get(bucket)?.status ?? "no-data");
        const totals = buckets.map((bucket) => statusByBucket.get(bucket)?.total ?? 0);
        const oks = buckets.map((bucket) => statusByBucket.get(bucket)?.ok ?? 0);
        const total = totals.reduce((sum, value) => sum + value, 0);
        const ok = oks.reduce((sum, value) => sum + value, 0);
        const uptimePct = total > 0 ? Number(((ok / total) * 100).toFixed(2)) : 100;

        return {
          checkId: acc.checkId,
          checkName: acc.checkName,
          region: acc.region,
          statuses,
          totals,
          p95: acc.p95Count > 0 ? Math.round(acc.p95Sum / acc.p95Count) : 0,
          errorRate: Number((100 - uptimePct).toFixed(2)),
          uptimePct,
          sampleCount: total
        };
      })
      .filter((row) => row.sampleCount > 0)
      .sort((a, b) => {
        const aw = Math.max(...a.statuses.map((state) => this.stateWeight(state)));
        const bw = Math.max(...b.statuses.map((state) => this.stateWeight(state)));
        if (aw !== bw) return bw - aw;
        return a.checkName.localeCompare(b.checkName);
      });

    return {
      points: buckets.length,
      buckets,
      rows
    };
  }

  async getRegionalSummary(params: {
    tenantId: string;
    range: RangeKey;
    serviceGroup: ServiceGroup;
    environment: string;
  }): Promise<
    Array<{
      region: string;
      checks: number;
      uptimePct: number;
      p95: number;
      errorRatePct: number;
      sampleCount: number;
    }>
  > {
    const intervalText = this.toInterval(params.range);
    const environment = this.normalizeEnvironment(params.environment);

    const result = await timescalePool.query<RegionalRow>(
      `
      SELECT
        s.region,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN s.ok THEN 1 ELSE 0 END), 0) AS ok_total,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY LEAST(s.latency_ms, 60000)) AS p95_latency_ms,
        COUNT(DISTINCT s.check_id) AS check_count
      FROM samples s
      INNER JOIN checks c ON c.id = s.check_id
      WHERE c.tenant_id = $1::uuid
        AND c.enabled = true
        AND lower(c.name) NOT LIKE '%smoke%'
        AND lower(c.name) NOT LIKE 'failing check%'
        AND lower(c.name) NOT LIKE '%pulse demo%'
        AND s.time >= NOW() - ($2::text)::interval
        AND (${this.serviceGroupSql("$3")})
        AND (${this.environmentSql("$4")})
      GROUP BY s.region
      ORDER BY s.region ASC
      `,
      [params.tenantId, intervalText, params.serviceGroup, environment]
    );

    const known = ["us-east", "eu-west", "ap-south"];
    const byRegion = new Map(
      result.rows.map((row) => {
        const total = Number(row.total ?? 0);
        const okTotal = Number(row.ok_total ?? 0);
        const uptimePct = total > 0 ? Number(((okTotal / total) * 100).toFixed(2)) : 100;
        return [
          row.region,
          {
            region: row.region,
            checks: Number(row.check_count ?? 0),
            uptimePct,
            p95: Math.round(Number(row.p95_latency_ms ?? 0)),
            errorRatePct: Number((100 - uptimePct).toFixed(2)),
            sampleCount: total
          }
        ] as const;
      })
    );

    return known.map((region) => {
      return (
        byRegion.get(region) ?? {
          region,
          checks: 0,
          uptimePct: 100,
          p95: 0,
          errorRatePct: 0,
          sampleCount: 0
        }
      );
    });
  }

  private environmentSql(param: string): string {
    return `
      EXISTS (
        SELECT 1
        FROM unnest(COALESCE(c.tags, ARRAY[]::text[])) AS tag
        WHERE lower(tag) = ('env:' || ${param}::text)
      )
      OR (
        ${param}::text = 'production'
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(c.tags, ARRAY[]::text[])) AS tag
          WHERE lower(tag) IN ('env:staging', 'env:development')
        )
      )
    `;
  }

  private serviceGroupSql(param: string): string {
    return `
      ${param}::text = 'all'
      OR (
        CASE
          WHEN lower(c.name) LIKE '%github%' THEN 'github'
          WHEN lower(c.name) LIKE '%openai%' THEN 'openai'
          WHEN lower(c.name) LIKE '%stripe%' THEN 'stripe'
          WHEN lower(c.name) LIKE '%cloudflare%' THEN 'cloudflare'
          WHEN lower(c.name) LIKE '%payment%' OR lower(c.name) LIKE '%checkout%' OR lower(c.name) LIKE '%billing%' THEN 'payments'
          WHEN lower(c.name) LIKE '%auth%' THEN 'auth'
          WHEN lower(c.name) LIKE '%search%' THEN 'search'
          WHEN lower(c.name) LIKE '%cart%' THEN 'cart'
          WHEN lower(c.name) LIKE '%httpbin%' OR lower(c.name) LIKE '%jsonplaceholder%' OR lower(c.name) LIKE '%npm%' OR lower(c.name) LIKE '%pypi%' OR lower(c.name) LIKE '%docker%' OR lower(c.name) LIKE '%dns%' OR lower(c.name) LIKE '%pulse demo%' THEN 'baseline'
          ELSE 'other'
        END
      ) = ${param}::text
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(c.tags, ARRAY[]::text[])) AS tag
        WHERE lower(tag) = ('vendor:' || ${param}::text)
           OR lower(tag) = ${param}::text
           OR (${param}::text = 'baseline' AND lower(tag) IN ('baseline', 'public', 'demo'))
      )
    `;
  }

  private normalizeEnvironment(environment: string): string {
    const value = (environment || "production").trim().toLowerCase();
    if (value === "staging" || value === "development" || value === "production") {
      return value;
    }
    return "production";
  }

  private normalizeRegionFilter(region: string): string {
    const value = (region || "all").trim().toLowerCase();
    if (!value || value === "all") {
      return "all";
    }

    if (value === "us-east-1") return "us-east";
    if (value === "eu-west-1") return "eu-west";
    if (value === "ap-south-1") return "ap-south";
    return value;
  }

  private toHealthState(total: number, okTotal: number, p95: number): HealthState {
    if (total <= 0) {
      return "no-data";
    }

    const uptime = okTotal / total;
    if (uptime < 0.99 || p95 >= 900) {
      return "down";
    }
    if (uptime < 0.999 || p95 >= 450) {
      return "degraded";
    }
    return "healthy";
  }

  private stateWeight(state: HealthState): number {
    if (state === "down") return 4;
    if (state === "degraded") return 3;
    if (state === "no-data") return 1;
    return 0;
  }

  private toInterval(range: RangeKey): string {
    if (range === "1h") return "1 hour";
    if (range === "24h") return "24 hours";
    if (range === "7d") return "7 days";
    return "30 days";
  }

  private toRangeMinutes(range: RangeKey): number {
    if (range === "1h") return 60;
    if (range === "24h") return 24 * 60;
    if (range === "7d") return 7 * 24 * 60;
    return 30 * 24 * 60;
  }
}
