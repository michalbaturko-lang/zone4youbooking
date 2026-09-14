import { Pool, type PoolClient } from "pg";
import { BookingApiError } from "./errors";
import { paymentDatabaseUrl } from "./paymentConfig";
import type { DurablePaymentLedger, PaymentClaimResult, VerifiedStripeTopup } from "./stripeTopup";

const paymentTable = "zone4you_payment_events";
const paymentSchemaTable = "zone4you_payment_schema";
const paymentSchemaVersion = 1;
const staleProcessingSeconds = 5 * 60;

interface PaymentLedgerRow {
  stripe_event_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string;
  user_id: string;
  amount_kc: number;
  amount_minor: number;
  currency: string;
  livemode: boolean;
  status: "processing" | "applied" | "uncertain";
  luxart_reference: string | null;
  reason_code: string | null;
  processing_age_seconds: string | number;
}

function samePayment(row: PaymentLedgerRow, topup: VerifiedStripeTopup) {
  return (
    row.stripe_checkout_session_id === topup.sessionId &&
    row.stripe_payment_intent_id === topup.paymentIntentId &&
    row.user_id === topup.userId &&
    Number(row.amount_kc) === topup.amountKc &&
    Number(row.amount_minor) === topup.amountMinor &&
    row.currency === topup.currency &&
    row.livemode === topup.livemode
  );
}

async function rollbackQuietly(client: PoolClient) {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresPaymentLedger implements DurablePaymentLedger {
  constructor(private readonly pool: Pool) {}

  async assertReady() {
    const result = await this.pool.query<{ table_name: string | null; schema_table_name: string | null }>(
      `SELECT
        to_regclass('zone4you_payment_events')::text AS table_name,
        to_regclass('zone4you_payment_schema')::text AS schema_table_name`,
    );
    if (
      result.rows[0]?.table_name !== paymentTable ||
      result.rows[0]?.schema_table_name !== paymentSchemaTable
    ) {
      throw new BookingApiError(503, "PAYMENT_LEDGER_NOT_READY", "Platební ledger není připraven.");
    }
    const schema = await this.pool.query<{ version: number; uniqueness_constraints: number }>(
      `SELECT
        COALESCE((SELECT MAX(version) FROM ${paymentSchemaTable}), 0)::int AS version,
        (SELECT COUNT(*) FROM pg_constraint
          WHERE conrelid = to_regclass('${paymentTable}') AND contype IN ('p', 'u'))::int AS uniqueness_constraints`,
    );
    if (
      schema.rows[0]?.version !== paymentSchemaVersion ||
      schema.rows[0]?.uniqueness_constraints < 3
    ) {
      throw new BookingApiError(503, "PAYMENT_LEDGER_NOT_READY", "Platební ledger má neplatnou verzi.");
    }
  }

  async claim(eventId: string, topup: VerifiedStripeTopup): Promise<PaymentClaimResult> {
    if (!eventId || !topup.sessionId) {
      throw new BookingApiError(409, "PAYMENT_LEDGER_INVALID", "Platbu nelze bezpečně identifikovat.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO ${paymentTable} (
          stripe_event_id, stripe_checkout_session_id, stripe_payment_intent_id,
          user_id, amount_kc, amount_minor, currency, livemode, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing')
        ON CONFLICT DO NOTHING
        RETURNING stripe_event_id`,
        [
          eventId,
          topup.sessionId,
          topup.paymentIntentId,
          topup.userId,
          topup.amountKc,
          topup.amountMinor,
          topup.currency,
          topup.livemode,
        ],
      );

      if (inserted.rowCount === 1) {
        await client.query("COMMIT");
        return "claimed";
      }

      const existing = await client.query<PaymentLedgerRow>(
        `SELECT *, EXTRACT(EPOCH FROM (now() - updated_at)) AS processing_age_seconds
         FROM ${paymentTable}
         WHERE stripe_event_id = $1 OR stripe_checkout_session_id = $2
         FOR UPDATE`,
        [eventId, topup.sessionId],
      );

      if (existing.rows.length !== 1 || !samePayment(existing.rows[0], topup)) {
        throw new BookingApiError(
          409,
          "PAYMENT_LEDGER_CONFLICT",
          "Stripe událost koliduje s jinou platbou a vyžaduje ruční kontrolu.",
        );
      }

      const row = existing.rows[0];
      let result: PaymentClaimResult;
      if (row.status === "applied") {
        result = "already_applied";
      } else if (row.status === "uncertain") {
        result = "uncertain";
      } else if (Number(row.processing_age_seconds) >= staleProcessingSeconds) {
        await client.query(
          `UPDATE ${paymentTable}
           SET status = 'uncertain', reason_code = 'PROCESSING_LEASE_EXPIRED', updated_at = now()
           WHERE stripe_event_id = $1 AND status = 'processing'`,
          [row.stripe_event_id],
        );
        result = "uncertain";
      } else {
        result = "in_progress";
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markApplied(eventId: string, luxartReference: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE ${paymentTable}
         SET status = 'applied', luxart_reference = $2, reason_code = NULL, updated_at = now()
         WHERE stripe_event_id = $1 AND status = 'processing'`,
        [eventId, luxartReference],
      );
      if (updated.rowCount !== 1) {
        const existing = await client.query<Pick<PaymentLedgerRow, "status" | "luxart_reference">>(
          `SELECT status, luxart_reference FROM ${paymentTable} WHERE stripe_event_id = $1 FOR UPDATE`,
          [eventId],
        );
        const row = existing.rows[0];
        if (!row || row.status !== "applied" || row.luxart_reference !== luxartReference) {
          throw new BookingApiError(409, "PAYMENT_LEDGER_STATE_INVALID", "Platební ledger nelze uzavřít.");
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markUncertain(eventId: string, reasonCode: string) {
    const normalizedReason = /^[A-Z0-9_]{1,64}$/.test(reasonCode) ? reasonCode : "UNCLASSIFIED_FAILURE";
    const result = await this.pool.query(
      `UPDATE ${paymentTable}
       SET status = 'uncertain', reason_code = $2, updated_at = now()
       WHERE stripe_event_id = $1 AND status = 'processing'`,
      [eventId, normalizedReason],
    );
    if (result.rowCount === 1) return;

    const existing = await this.pool.query<Pick<PaymentLedgerRow, "status">>(
      `SELECT status FROM ${paymentTable} WHERE stripe_event_id = $1`,
      [eventId],
    );
    if (existing.rows[0]?.status === "applied" || existing.rows[0]?.status === "uncertain") return;
    throw new BookingApiError(409, "PAYMENT_LEDGER_STATE_INVALID", "Platbu nelze označit ke kontrole.");
  }
}

const globalPaymentPool = globalThis as typeof globalThis & { zone4youPaymentPool?: Pool };

export function getPaymentPool() {
  if (!globalPaymentPool.zone4youPaymentPool) {
    const configuredPoolMax = Number(process.env.PAYMENT_DATABASE_POOL_MAX ?? "2");
    const poolMax = Number.isInteger(configuredPoolMax) ? Math.max(1, Math.min(5, configuredPoolMax)) : 2;
    globalPaymentPool.zone4youPaymentPool = new Pool({
      connectionString: paymentDatabaseUrl(),
      application_name: "zone4you-booking-payments",
      max: poolMax,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
    });
  }
  return globalPaymentPool.zone4youPaymentPool;
}

export function getPostgresPaymentLedger() {
  return new PostgresPaymentLedger(getPaymentPool());
}
