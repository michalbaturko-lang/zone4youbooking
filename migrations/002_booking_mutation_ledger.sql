CREATE TABLE IF NOT EXISTS zone4you_booking_mutation_schema (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO zone4you_booking_mutation_schema (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS zone4you_booking_mutations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create_reservation', 'cancel_reservation')),
  target_id text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'applied', 'rejected', 'uncertain')),
  response_json jsonb,
  error_status integer,
  error_code text,
  error_message text,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CHECK (
    (status = 'applied' AND response_json IS NOT NULL AND error_code IS NULL) OR
    (status = 'rejected' AND response_json IS NULL AND error_status IS NOT NULL AND error_code IS NOT NULL) OR
    (status IN ('processing', 'uncertain') AND response_json IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS zone4you_booking_mutations_target_status_idx
  ON zone4you_booking_mutations (user_id, operation, target_id, status, updated_at DESC);
