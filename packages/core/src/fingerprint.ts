import { createHash } from "crypto";

export type AlertEvaluationInput = {
  checkId: string;
  vendorTag: string | null;
  ok: boolean;
  error: string | null;
  statusCode: number | null;
};

export type AlertEvaluation = {
  shouldAlert: boolean;
  fingerprint: string;
};

/** Deterministic incident fingerprint + alert gate used by the alerter. */
export function evaluateAlert(input: AlertEvaluationInput): AlertEvaluation {
  const fingerprint = createHash("sha256")
    .update(`${input.checkId}:${input.vendorTag ?? "none"}:${input.error ?? input.statusCode}`)
    .digest("hex");

  return {
    shouldAlert: !input.ok,
    fingerprint
  };
}

/** Sliding-window dedupe: returns true when this fingerprint should open a new incident. */
export function shouldOpenIncident(
  fingerprint: string,
  seen: Map<string, number>,
  nowMs: number,
  windowMs = 300_000
): boolean {
  const expiresAt = seen.get(fingerprint);
  if (expiresAt !== undefined && expiresAt > nowMs) {
    return false;
  }
  seen.set(fingerprint, nowMs + windowMs);
  return true;
}
