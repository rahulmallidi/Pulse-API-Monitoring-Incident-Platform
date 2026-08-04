import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { MetricsService } from "./metrics.service";

type RangeKey = "1h" | "24h" | "7d" | "30d";
type ServiceGroup =
  | "all"
  | "payments"
  | "auth"
  | "search"
  | "cart"
  | "other"
  | "github"
  | "openai"
  | "stripe"
  | "cloudflare"
  | "baseline";

@ApiTags("metrics")
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get("summary")
  @ApiOperation({ summary: "Historical latency and availability summary" })
  @ApiResponse({ status: 200, description: "Summary loaded" })
  async summary(
    @Headers("x-tenant-id") tenantId: string,
    @Query("range") range: string,
    @Query("region") region?: string,
    @Query("serviceGroup") serviceGroup?: string,
    @Query("environment") environment?: string
  ): Promise<{
    sampleCount: number;
    uptimePct: number;
    errorRatePct: number;
    p50: number;
    p95: number;
    p99: number;
  }> {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.metricsService.getHistoricalSummary({
      tenantId,
      range: this.parseRange(range),
      region: region && region.trim() ? region : "all",
      serviceGroup: this.parseServiceGroup(serviceGroup),
      environment: this.parseEnvironment(environment)
    });
  }

  @Get("latency-series")
  @ApiOperation({ summary: "Latency percentile time series for dashboard charts" })
  @ApiResponse({ status: 200, description: "Latency series loaded" })
  async latencySeries(
    @Headers("x-tenant-id") tenantId: string,
    @Query("range") range: string,
    @Query("region") region?: string,
    @Query("serviceGroup") serviceGroup?: string,
    @Query("points") points?: string,
    @Query("environment") environment?: string
  ): Promise<{
    points: number;
    sampleCount: number;
    buckets: string[];
    p50: Array<number | null>;
    p95: Array<number | null>;
    p99: Array<number | null>;
  }> {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.metricsService.getLatencySeries({
      tenantId,
      range: this.parseRange(range),
      region: region && region.trim() ? region : "all",
      serviceGroup: this.parseServiceGroup(serviceGroup),
      points: this.parsePoints(points),
      environment: this.parseEnvironment(environment)
    });
  }

  @Get("heatmap")
  @ApiOperation({ summary: "Per-check uptime heatmap for dashboard" })
  @ApiResponse({ status: 200, description: "Heatmap loaded" })
  async heatmap(
    @Headers("x-tenant-id") tenantId: string,
    @Query("range") range: string,
    @Query("region") region?: string,
    @Query("serviceGroup") serviceGroup?: string,
    @Query("points") points?: string,
    @Query("environment") environment?: string
  ): Promise<{
    points: number;
    buckets: string[];
    rows: Array<{
      checkId: string;
      checkName: string;
      region: string;
      statuses: Array<"healthy" | "degraded" | "down" | "no-data">;
      totals: number[];
      p95: number;
      errorRate: number;
      uptimePct: number;
      sampleCount: number;
    }>;
  }> {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.metricsService.getHeatmap({
      tenantId,
      range: this.parseRange(range),
      region: region && region.trim() ? region : "all",
      serviceGroup: this.parseServiceGroup(serviceGroup),
      points: this.parsePoints(points),
      environment: this.parseEnvironment(environment)
    });
  }

  @Get("regional")
  @ApiOperation({ summary: "Regional latency and uptime summary" })
  @ApiResponse({ status: 200, description: "Regional summary loaded" })
  async regional(
    @Headers("x-tenant-id") tenantId: string,
    @Query("range") range: string,
    @Query("serviceGroup") serviceGroup?: string,
    @Query("environment") environment?: string
  ): Promise<
    Array<{
      region: string;
      checks: number;
      uptimePct: number;
      p95: number;
      errorRatePct: number;
      sampleCount: number;
    }>
  > {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.metricsService.getRegionalSummary({
      tenantId,
      range: this.parseRange(range),
      serviceGroup: this.parseServiceGroup(serviceGroup),
      environment: this.parseEnvironment(environment)
    });
  }

  private parseRange(input?: string): RangeKey {
    if (input === "1h" || input === "24h" || input === "7d" || input === "30d") {
      return input;
    }

    return "24h";
  }

  private parseServiceGroup(input?: string): ServiceGroup {
    const allowed: ServiceGroup[] = [
      "payments",
      "auth",
      "search",
      "cart",
      "other",
      "github",
      "openai",
      "stripe",
      "cloudflare",
      "baseline"
    ];

    if (input && (allowed as string[]).includes(input)) {
      return input as ServiceGroup;
    }

    return "all";
  }

  private parseEnvironment(input?: string): string {
    if (input === "staging" || input === "development" || input === "production") {
      return input;
    }
    return "production";
  }

  private parsePoints(input?: string): number {
    const value = Number.parseInt(input ?? "", 10);
    if (Number.isNaN(value)) {
      return 24;
    }

    return Math.min(240, Math.max(6, value));
  }
}
