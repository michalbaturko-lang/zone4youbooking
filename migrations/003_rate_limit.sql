CREATE TABLE IF NOT EXISTS zone4you_rate_limit_schema (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO zone4you_rate_limit_schema (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS zone4you_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  scope text NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 1),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(bucket_key) BETWEEN 1 AND 128),
  CHECK (length(scope) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS zone4you_rate_limit_buckets_reset_at_idx
  ON zone4you_rate_limit_buckets (reset_at);
