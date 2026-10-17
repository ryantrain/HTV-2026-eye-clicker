CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS patients (
  id text PRIMARY KEY,
  dwell_ms integer NOT NULL DEFAULT 2000 CHECK (dwell_ms BETWEEN 1000 AND 5000),
  blink_threshold double precision NOT NULL DEFAULT 0.5 CHECK (blink_threshold > 0 AND blink_threshold < 1)
);
INSERT INTO patients(id) VALUES ('demo-patient') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS work_orders (
  id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients(id),
  created_at timestamptz NOT NULL DEFAULT now(), intent text NOT NULL,
  department text NOT NULL, summary text NOT NULL, source text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','completed'))
);
CREATE TABLE IF NOT EXISTS gaze_metrics (
  timestamp timestamptz NOT NULL DEFAULT now(), patient_id text NOT NULL REFERENCES patients(id),
  gaze_x double precision NOT NULL, gaze_y double precision NOT NULL,
  jitter_delta double precision NOT NULL, blink_duration_ms double precision NOT NULL
);
SELECT create_hypertable('gaze_metrics', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS gaze_patient_time ON gaze_metrics(patient_id, timestamp DESC);
CREATE MATERIALIZED VIEW IF NOT EXISTS gaze_five_minutes
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '5 minutes', timestamp) AS bucket, patient_id,
  least(2, floor(gaze_x * 3)::integer) AS cell_x, least(1, floor(gaze_y * 2)::integer) AS cell_y,
  count(*) AS samples, avg(jitter_delta) AS avg_jitter,
  count(*) FILTER (WHERE blink_duration_ms > 0) AS blinks,
  avg(NULLIF(blink_duration_ms, 0)) AS avg_blink_ms
FROM gaze_metrics GROUP BY bucket, patient_id, cell_x, cell_y WITH NO DATA;
SELECT add_continuous_aggregate_policy('gaze_five_minutes', start_offset => INTERVAL '1 day', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE);
SELECT add_retention_policy('gaze_metrics', INTERVAL '7 days', if_not_exists => TRUE);
