export type SloWindow = {
  successfulProbes: number;
  totalProbes: number;
  target: number;
};

export type SloEvaluation = {
  availability: number;
  errorRatio: number;
  errorBudgetRatio: number;
  remainingBudget: number;
  burnRate: number;
  compliant: boolean;
  pagingSeverity: boolean;
};

/** Availability / error-budget / burn-rate math used by Pulse SLO evaluation. */
export function evaluateSlo(input: SloWindow): SloEvaluation {
  if (input.totalProbes < 0 || input.successfulProbes < 0) {
    throw new Error("probe counts must be non-negative");
  }
  if (input.successfulProbes > input.totalProbes) {
    throw new Error("successfulProbes cannot exceed totalProbes");
  }
  if (input.target <= 0 || input.target >= 1) {
    throw new Error("target must be in (0, 1)");
  }

  const availability = input.totalProbes === 0 ? 1 : input.successfulProbes / input.totalProbes;
  const errorRatio = 1 - availability;
  const errorBudgetRatio = 1 - input.target;
  const remainingBudget = Math.max(0, errorBudgetRatio - errorRatio);
  const burnRate = errorBudgetRatio === 0 ? Number.POSITIVE_INFINITY : errorRatio / errorBudgetRatio;

  return {
    availability,
    errorRatio,
    errorBudgetRatio,
    remainingBudget,
    burnRate,
    compliant: availability >= input.target,
    pagingSeverity: burnRate > 2
  };
}

/** Nearest-rank percentile over a sorted copy; latency values are clipped at maxMs. */
export function percentile(values: number[], p: number, maxMs = 60_000): number {
  if (values.length === 0) {
    return 0;
  }
  if (p < 0 || p > 1) {
    throw new Error("percentile p must be in [0, 1]");
  }

  const clipped = values.map((value) => Math.min(Math.max(0, value), maxMs)).sort((a, b) => a - b);
  const rank = Math.min(clipped.length - 1, Math.max(0, Math.ceil(p * clipped.length) - 1));
  return clipped[rank] ?? 0;
}

export function summarizeLatencies(values: number[]): { p50: number; p95: number; p99: number } {
  return {
    p50: Math.round(percentile(values, 0.5)),
    p95: Math.round(percentile(values, 0.95)),
    p99: Math.round(percentile(values, 0.99))
  };
}
