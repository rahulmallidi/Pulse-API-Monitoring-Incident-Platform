# Anomaly Detection

Pulse uses a rolling EWMA baseline with z-score gating.

## Definitions

Given latency series x_t:

- EWMA baseline: m_t = alpha * x_t + (1 - alpha) * m_(t-1)
- Rolling deviation: sigma_t estimated over the last N residuals r_t = x_t - m_t
- Z-score: z_t = (x_t - m_t) / sigma_t

An anomaly is flagged when z_t > 3 for 3 consecutive samples.

## Notes

- Lower alpha smooths noise and catches sustained drift.
- Higher alpha reacts quickly but increases false positives.
- Per-check tuning can be applied for noisy dependencies.
