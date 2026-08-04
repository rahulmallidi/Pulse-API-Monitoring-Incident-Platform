import { Injectable } from "@nestjs/common";
import { ProbeJobEvent, Sample, sampleSchema } from "@pulse/contracts";
import { request } from "undici";

const USER_AGENT = "Pulse-Monitor/0.1 (+https://github.com/you/pulse; contact@example.com)";

@Injectable()
export class HttpExecutor {
  async run(job: ProbeJobEvent): Promise<Sample> {
    const startedAt = Date.now();

    try {
      const method = job.config.method ?? "GET";
      const targetUrl = job.config.url;

      if (!targetUrl) {
        throw new Error("HTTP check requires config.url");
      }

      const response = await request(targetUrl, {
        method,
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json"
        },
        maxRedirections: 3,
        headersTimeout: 10_000,
        bodyTimeout: 10_000
      });
      const body = await response.body.text();
      const latencyMs = Date.now() - startedAt;

      const expectedStatus = job.config.expectedStatus;
      const expectedStatusIn = job.config.expectedStatusIn;
      const expectedBodyIncludes = job.config.expectedBodyIncludes;
      const expectedContentTypeIncludes = job.config.expectedContentTypeIncludes;
      const contentType = String(response.headers["content-type"] ?? "");

      const statusPass = expectedStatus
        ? response.statusCode === expectedStatus
        : expectedStatusIn && expectedStatusIn.length > 0
          ? expectedStatusIn.includes(response.statusCode)
          : response.statusCode >= 200 && response.statusCode < 300;

      const bodyPass = expectedBodyIncludes ? body.includes(expectedBodyIncludes) : true;
      const contentTypePass = expectedContentTypeIncludes ? contentType.includes(expectedContentTypeIncludes) : true;
      const assertionFailures: string[] = [];
      if (!statusPass) {
        assertionFailures.push("status_mismatch");
      }
      if (!bodyPass) {
        assertionFailures.push("body_assertion_failed");
      }
      if (!contentTypePass) {
        assertionFailures.push("content_type_assertion_failed");
      }

      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: statusPass && bodyPass && contentTypePass,
        latencyMs,
        statusCode: response.statusCode,
        error: statusPass && bodyPass && contentTypePass ? null : "HTTP assertion failed",
        sizeBytes: Buffer.byteLength(body),
        assertionFailures
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "unknown error";

      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: false,
        latencyMs,
        statusCode: null,
        error: message,
        sizeBytes: null,
        assertionFailures: ["request_failed"]
      });
    }
  }
}
