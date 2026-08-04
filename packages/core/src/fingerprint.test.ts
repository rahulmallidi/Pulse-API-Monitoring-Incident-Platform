import { describe, expect, it } from "vitest";
import { evaluateAlert, shouldOpenIncident } from "./fingerprint";

describe("evaluateAlert", () => {
  it("opens alerts only for failed samples", () => {
    const failed = evaluateAlert({
      checkId: "11111111-1111-1111-1111-111111111111",
      vendorTag: "github",
      ok: false,
      error: "HTTP assertion failed",
      statusCode: 500
    });
    const ok = evaluateAlert({
      checkId: "11111111-1111-1111-1111-111111111111",
      vendorTag: "github",
      ok: true,
      error: null,
      statusCode: 200
    });

    expect(failed.shouldAlert).toBe(true);
    expect(ok.shouldAlert).toBe(false);
    expect(failed.fingerprint).toHaveLength(64);
  });

  it("is deterministic for identical failure signatures", () => {
    const a = evaluateAlert({
      checkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      vendorTag: null,
      ok: false,
      error: "timeout",
      statusCode: null
    });
    const b = evaluateAlert({
      checkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      vendorTag: null,
      ok: false,
      error: "timeout",
      statusCode: null
    });

    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("shouldOpenIncident", () => {
  it("deduplicates fingerprints inside the suppression window", () => {
    const seen = new Map<string, number>();
    const fingerprint = "abc";

    expect(shouldOpenIncident(fingerprint, seen, 1_000, 300_000)).toBe(true);
    expect(shouldOpenIncident(fingerprint, seen, 2_000, 300_000)).toBe(false);
    expect(shouldOpenIncident(fingerprint, seen, 301_001, 300_000)).toBe(true);
  });
});
