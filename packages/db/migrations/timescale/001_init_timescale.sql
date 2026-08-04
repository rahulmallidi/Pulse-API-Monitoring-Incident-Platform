CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS samples (
  time TIMESTAMPTZ NOT NULL,
  check_id UUID NOT NULL,
  region TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  latency_ms DOUBLE PRECISION NOT NULL,
  status_code INTEGER,
  error TEXT,
  size_bytes INTEGER,
  PRIMARY KEY (check_id, region, time)
);

SELECT create_hypertable('samples', by_range('time'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_samples_check_time_desc ON samples (check_id, time DESC);
COMMENT ON INDEX idx_samples_check_time_desc IS 'Serves latency charts for a single check over time windows.';

CREATE MATERIALIZED VIEW IF NOT EXISTS samples_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 minute', time) AS bucket,
  check_id,
  region,
  COUNT(*) AS total,
  SUM(CASE WHEN ok THEN 1 ELSE 0 END) AS ok_total,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms
FROM samples
GROUP BY bucket, check_id, region
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS samples_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '5 minute', time) AS bucket,
  check_id,
  region,
  COUNT(*) AS total,
  SUM(CASE WHEN ok THEN 1 ELSE 0 END) AS ok_total,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms
FROM samples
GROUP BY bucket, check_id, region
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS samples_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', time) AS bucket,
  check_id,
  region,
  COUNT(*) AS total,
  SUM(CASE WHEN ok THEN 1 ELSE 0 END) AS ok_total,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms
FROM samples
GROUP BY bucket, check_id, region
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS samples_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 day', time) AS bucket,
  check_id,
  region,
  COUNT(*) AS total,
  SUM(CASE WHEN ok THEN 1 ELSE 0 END) AS ok_total,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_latency_ms
FROM samples
GROUP BY bucket, check_id, region
WITH NO DATA;

SELECT add_continuous_aggregate_policy('samples_1m',
  start_offset => INTERVAL '15 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('samples_5m',
  start_offset => INTERVAL '1 day',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('samples_1h',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('samples_1d',
  start_offset => INTERVAL '90 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

ALTER TABLE samples SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'check_id,region'
);

SELECT add_compression_policy('samples', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('samples', INTERVAL '180 days', if_not_exists => TRUE);
