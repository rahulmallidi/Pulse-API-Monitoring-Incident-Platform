import { Injectable } from "@nestjs/common";
import { ProbeJobEvent, Sample, sampleSchema } from "@pulse/contracts";
import dns from "node:dns/promises";

@Injectable()
export class DnsExecutor {
  async run(job: ProbeJobEvent): Promise<Sample> {
    const host = job.config.host;
    const recordType = job.config.recordType ?? "A";
    const startedAt = Date.now();

    if (!host) {
      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: false,
        latencyMs: 0,
        statusCode: null,
        error: "DNS check requires config.host",
        sizeBytes: null
      });
    }

    try {
      switch (recordType) {
        case "AAAA":
          await dns.resolve6(host);
          break;
        case "CNAME":
          await dns.resolveCname(host);
          break;
        case "TXT":
          await dns.resolveTxt(host);
          break;
        case "MX":
          await dns.resolveMx(host);
          break;
        case "A":
        default:
          await dns.resolve4(host);
          break;
      }

      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: true,
        latencyMs: Date.now() - startedAt,
        statusCode: null,
        error: null,
        sizeBytes: null
      });
    } catch (error) {
      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: false,
        latencyMs: Date.now() - startedAt,
        statusCode: null,
        error: error instanceof Error ? error.message : "DNS resolution failed",
        sizeBytes: null
      });
    }
  }
}
