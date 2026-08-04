import { describe, expect, it } from "vitest";
import { createCheckSchema, probeJobEventSchema, sampleSchema } from "./index";

const tenantId = "11111111-1111-1111-1111-111111111111";
const checkId = "22222222-2222-2222-2222-222222222222";

describe("contracts schemas", () => {
  it("accepts a multi-region HTTP check create payload", () => {
    const parsed = createCheckSchema.parse({
      tenantId,
      name: "github-api",
      type: "http",
      config: {
        url: "https://api.github.com",
        method: "GET",
        expectedStatusIn: [200, 301]
      },
      intervalS: 60,
      regions: ["us-east", "eu-west", "ap-south"],
      tags: ["github", "env:production"]
    });

    expect(parsed.regions).toHaveLength(3);
    expect(parsed.enabled).toBe(true);
  });

  it("rejects intervals below the 30s floor", () => {
    expect(() =>
      createCheckSchema.parse({
        tenantId,
        name: "too-fast",
        type: "http",
        config: { url: "https://example.com" },
        intervalS: 5,
        regions: ["us-east"]
      })
    ).toThrow();
  });

  it("round-trips probe job and sample envelopes", () => {
    const job = probeJobEventSchema.parse({
      tenantId,
      checkId,
      region: "eu-west",
      type: "http",
      config: { url: "https://httpbin.org/get", method: "GET" },
      dispatchedAt: new Date().toISOString()
    });

    const sample = sampleSchema.parse({
      time: new Date().toISOString(),
      checkId,
      region: job.region,
      ok: true,
      latencyMs: 42,
      statusCode: 200,
      error: null,
      sizeBytes: 128,
      assertionFailures: []
    });

    expect(sample.ok).toBe(true);
    expect(job.region).toBe("eu-west");
  });
});
