CREATE TABLE IF NOT EXISTS zone4you_payment_schema (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO zone4you_payment_schema (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS zone4you_payment_events (
  stripe_event_id text PRIMARY KEY,
  stripe_checkout_session_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text NOT NULL UNIQUE,
  user_id text NOT NULL,
  amount_kc integer NOT NULL CHECK (amount_kc > 0),
  amount_minor integer NOT NULL CHECK (amount_minor = amount_kc * 100),
  currency text NOT NULL CHECK (currency = 'czk'),
  livemode boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'applied', 'uncertain')),
  luxart_reference text,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'applied' AND luxart_reference IS NOT NULL AND reason_code IS NULL)
    OR (status = 'uncertain' AND reason_code IS NOT NULL AND luxart_reference IS NULL)
    OR (status = 'processing' AND luxart_reference IS NULL AND reason_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS zone4you_payment_events_status_updated_idx
  ON zone4you_payment_events (status, updated_at);
