import { describe, expect, it } from "vitest";
import { evaluateSlo, percentile, summarizeLatencies } from "./slo";

describe("evaluateSlo", () => {
  it("reports compliance for a 99.9% target with enough success", () => {
    const result = evaluateSlo({
      successfulProbes: 9990,
      totalProbes: 10_000,
      target: 0.999
    });

    expect(result.availability).toBeCloseTo(0.999, 6);
    expect(result.compliant).toBe(true);
    expect(result.errorBudgetRatio).toBeCloseTo(0.001, 9);
    expect(result.burnRate).toBeCloseTo(1, 6);
    expect(result.pagingSeverity).toBe(false);
  });

  it("flags paging severity when burn rate exceeds 2x", () => {
    const result = evaluateSlo({
      successfulProbes: 9970,
      totalProbes: 10_000,
      target: 0.999
    });

    expect(result.compliant).toBe(false);
    expect(result.burnRate).toBeGreaterThan(2);
    expect(result.pagingSeverity).toBe(true);
    expect(result.remainingBudget).toBe(0);
  });

  it("treats empty windows as fully available", () => {
    const result = evaluateSlo({
      successfulProbes: 0,
      totalProbes: 0,
      target: 0.99
    });

    expect(result.availability).toBe(1);
    expect(result.compliant).toBe(true);
  });
});

describe("percentile", () => {
  it("clips extreme outliers before ranking", () => {
    const values = [10, 20, 30, 40, 50, 3_300_000];
    expect(percentile(values, 0.99)).toBeLessThanOrEqual(60_000);
  });

  it("returns rounded latency summary for dashboard charts", () => {
    const summary = summarizeLatencies([12, 18, 22, 40, 55, 80, 120, 200, 400, 900]);
    expect(summary.p50).toBeGreaterThan(0);
    expect(summary.p95).toBeGreaterThanOrEqual(summary.p50);
    expect(summary.p99).toBeGreaterThanOrEqual(summary.p95);
  });
});
