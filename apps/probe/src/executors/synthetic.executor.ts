import { Injectable } from "@nestjs/common";
import { ProbeJobEvent, Sample, sampleSchema } from "@pulse/contracts";
import { request } from "undici";

const USER_AGENT = "Pulse-Monitor/0.1 (+https://github.com/you/pulse; contact@example.com)";

@Injectable()
export class SyntheticExecutor {
  async run(job: ProbeJobEvent): Promise<Sample> {
    const startedAt = Date.now();
    const steps = job.config.syntheticSteps;

    if (!steps || steps.length === 0) {
      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: false,
        latencyMs: 0,
        statusCode: null,
        error: "Synthetic check requires config.syntheticSteps",
        sizeBytes: null
      });
    }

    let lastStatus: number | null = null;
    let totalBytes = 0;

    try {
      const assertionFailures: string[] = [];
      for (const step of steps) {
        const response = await request(step.url, {
          method: step.method,
          headers: {
            "user-agent": USER_AGENT,
            accept: "application/json",
            ...step.headers
          },
          maxRedirections: 3,
          headersTimeout: 10_000,
          bodyTimeout: 10_000
        });

        const body = await response.body.text();
        totalBytes += Buffer.byteLength(body);
        lastStatus = response.statusCode;
        const contentType = String(response.headers["content-type"] ?? "");

        const statusPass = step.expectedStatus
          ? response.statusCode === step.expectedStatus
          : step.expectedStatusIn && step.expectedStatusIn.length > 0
            ? step.expectedStatusIn.includes(response.statusCode)
            : response.statusCode >= 200 && response.statusCode < 300;

        if (!statusPass) {
          assertionFailures.push(`${step.name}:status_mismatch`);
          throw new Error(`Synthetic step ${step.name} expected ${step.expectedStatus}, got ${response.statusCode}`);
        }

        if (step.expectedBodyIncludes && !body.includes(step.expectedBodyIncludes)) {
          assertionFailures.push(`${step.name}:body_assertion_failed`);
          throw new Error(`Synthetic step ${step.name} body assertion failed`);
        }

        if (step.expectedContentTypeIncludes && !contentType.includes(step.expectedContentTypeIncludes)) {
          assertionFailures.push(`${step.name}:content_type_assertion_failed`);
          throw new Error(`Synthetic step ${step.name} content-type assertion failed`);
        }
      }

      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: true,
        latencyMs: Date.now() - startedAt,
        statusCode: lastStatus,
        error: null,
        sizeBytes: totalBytes,
        assertionFailures: []
      });
    } catch (error) {
      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: false,
        latencyMs: Date.now() - startedAt,
        statusCode: lastStatus,
        error: error instanceof Error ? error.message : "Synthetic check failed",
        sizeBytes: totalBytes || null,
        assertionFailures: ["synthetic_step_failed"]
      });
    }
  }
}
