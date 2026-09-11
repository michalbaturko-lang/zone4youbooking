import { Pool, type PoolClient } from "pg";
import { bookingDatabaseUrl } from "./bookingMutationConfig";
import { BookingApiError } from "./errors";

export type BookingMutationOperation = "create_reservation" | "cancel_reservation";
export type BookingMutationClaim = "claimed" | "applied" | "rejected" | "in_progress" | "uncertain";

export interface BookingMutationIdentity {
  userId: string;
  idempotencyKey: string;
  operation: BookingMutationOperation;
  targetId: string;
  requestFingerprint: string;
}

export interface StoredBookingMutationError {
  status: number;
  code: string;
  message: string;
}

export interface BookingMutationLease<T> {
  claim: BookingMutationClaim;
  response?: T;
  error?: StoredBookingMutationError;
  markApplied(response: T): Promise<void>;
  markRejected(error: StoredBookingMutationError): Promise<void>;
  markUncertain(reasonCode: string): Promise<void>;
  discard(): Promise<void>;
  release(): Promise<void>;
}

export interface DurableBookingMutationLedger {
  assertReady(): Promise<void>;
  acquire<T>(identity: BookingMutationIdentity): Promise<BookingMutationLease<T>>;
}

interface BookingMutationRow {
  user_id: string;
  idempotency_key: string;
  operation: BookingMutationOperation;
  target_id: string;
  request_fingerprint: string;
  status: "processing" | "applied" | "rejected" | "uncertain";
  response_json: unknown;
  error_status: number | null;
  error_code: string | null;
  error_message: string | null;
}

const mutationTable = "zone4you_booking_mutations";
const schemaTable = "zone4you_booking_mutation_schema";
const schemaVersion = 1;

function safeReasonCode(reasonCode: string) {
  return /^[A-Z0-9_]{1,64}$/.test(reasonCode) ? reasonCode : "UNCLASSIFIED_FAILURE";
}

class PostgresBookingMutationLease<T> implements BookingMutationLease<T> {
  private released = false;

  constructor(
    readonly claim: BookingMutationClaim,
    private readonly identity: BookingMutationIdentity,
    private readonly client?: PoolClient,
    readonly response?: T,
    readonly error?: StoredBookingMutationError,
  ) {}

  private requireClient() {
    if (this.claim !== "claimed" || !this.client || this.released) {
      throw new BookingApiError(409, "BOOKING_LEDGER_STATE_INVALID", "Stav ochrany rezervace není platný.");
    }
    return this.client;
  }

  private async update(sql: string, parameters: unknown[]) {
    const result = await this.requireClient().query(sql, parameters);
    if (result.rowCount !== 1) {
      throw new BookingApiError(409, "BOOKING_LEDGER_STATE_INVALID", "Stav ochrany rezervace nelze uzavřít.");
    }
  }

  async markApplied(response: T) {
    await this.update(
      `UPDATE ${mutationTable}
       SET status = 'applied', response_json = $3::jsonb, error_status = NULL,
           error_code = NULL, error_message = NULL, reason_code = NULL, updated_at = now()
       WHERE user_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
      [this.identity.userId, this.identity.idempotencyKey, JSON.stringify(response)],
    );
  }

  async markRejected(error: StoredBookingMutationError) {
    await this.update(
      `UPDATE ${mutationTable}
       SET status = 'rejected', error_status = $3, error_code = $4,
           error_message = $5, reason_code = NULL, updated_at = now()
       WHERE user_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
      [this.identity.userId, this.identity.idempotencyKey, error.status, error.code, error.message],
    );
  }

  async markUncertain(reasonCode: string) {
    await this.update(
      `UPDATE ${mutationTable}
       SET status = 'uncertain', reason_code = $3, updated_at = now()
       WHERE user_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
      [this.identity.userId, this.identity.idempotencyKey, safeReasonCode(reasonCode)],
    );
  }

  async discard() {
    await this.update(
      `DELETE FROM ${mutationTable}
       WHERE user_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
      [this.identity.userId, this.identity.idempotencyKey],
    );
  }

  async release() {
    if (this.released) return;
    this.released = true;
    if (!this.client) return;
    try {
      await this.client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        `zone4you-booking-user:${this.identity.userId}`,
      ]);
      this.client.release();
    } catch (error) {
      this.client.release(error instanceof Error ? error : new Error("Failed to release booking advisory lock."));
    }
  }
}

function rowError(row: BookingMutationRow): StoredBookingMutationError | undefined {
  if (row.status !== "rejected" || !row.error_status || !row.error_code || !row.error_message) return undefined;
  return { status: row.error_status, code: row.error_code, message: row.error_message };
}

export class PostgresBookingMutationLedger implements DurableBookingMutationLedger {
  constructor(private readonly pool: Pool) {}

  async assertReady() {
    const result = await this.pool.query<{ table_name: string | null; schema_table_name: string | null }>(
      `SELECT
        to_regclass('${mutationTable}')::text AS table_name,
        to_regclass('${schemaTable}')::text AS schema_table_name`,
    );
    if (result.rows[0]?.table_name !== mutationTable || result.rows[0]?.schema_table_name !== schemaTable) {
      throw new BookingApiError(503, "BOOKING_LEDGER_NOT_READY", "Ochrana rezervací není připravena.");
    }
    const schema = await this.pool.query<{ version: number; uniqueness_constraints: number }>(
      `SELECT
        COALESCE((SELECT MAX(version) FROM ${schemaTable}), 0)::int AS version,
        (SELECT COUNT(*) FROM pg_constraint
          WHERE conrelid = to_regclass('${mutationTable}') AND contype IN ('p', 'u'))::int AS uniqueness_constraints`,
    );
    if (schema.rows[0]?.version !== schemaVersion || schema.rows[0]?.uniqueness_constraints < 2) {
      throw new BookingApiError(503, "BOOKING_LEDGER_NOT_READY", "Ochrana rezervací má neplatnou verzi.");
    }
  }

  async acquire<T>(identity: BookingMutationIdentity): Promise<BookingMutationLease<T>> {
    const client = await this.pool.connect();
    let lockAcquired = false;
    try {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [`zone4you-booking-user:${identity.userId}`],
      );
      lockAcquired = lock.rows[0]?.acquired === true;
      if (!lockAcquired) {
        client.release();
        return new PostgresBookingMutationLease<T>("in_progress", identity);
      }

      const existing = await client.query<BookingMutationRow>(
        `SELECT * FROM ${mutationTable} WHERE user_id = $1 AND idempotency_key = $2`,
        [identity.userId, identity.idempotencyKey],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        if (
          existingRow.request_fingerprint !== identity.requestFingerprint ||
          existingRow.operation !== identity.operation ||
          existingRow.target_id !== identity.targetId
        ) {
          throw new BookingApiError(
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "Bezpečnostní identifikátor už patří jiné booking akci.",
          );
        }
        if (existingRow.status === "processing") {
          await client.query(
            `UPDATE ${mutationTable}
             SET status = 'uncertain', reason_code = 'ORPHANED_PROCESSING', updated_at = now()
             WHERE user_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
            [identity.userId, identity.idempotencyKey],
          );
          return new PostgresBookingMutationLease<T>("uncertain", identity, client);
        }
        if (existingRow.status === "applied") {
          return new PostgresBookingMutationLease<T>("applied", identity, client, existingRow.response_json as T);
        }
        if (existingRow.status === "rejected") {
          return new PostgresBookingMutationLease<T>("rejected", identity, client, undefined, rowError(existingRow));
        }
        return new PostgresBookingMutationLease<T>("uncertain", identity, client);
      }

      const recentApplied = await client.query<Pick<BookingMutationRow, "response_json">>(
        `SELECT prior.response_json
         FROM ${mutationTable} prior
         WHERE prior.user_id = $1
           AND prior.operation = $2
           AND prior.target_id = $3
           AND prior.status = 'applied'
           AND (
             prior.operation = 'cancel_reservation' OR
             (
               prior.updated_at >= now() - interval '2 minutes'
               AND NOT EXISTS (
                 SELECT 1
                 FROM ${mutationTable} cancellation
                 WHERE cancellation.user_id = prior.user_id
                   AND cancellation.operation = 'cancel_reservation'
                   AND cancellation.status = 'applied'
                   AND cancellation.updated_at >= prior.updated_at
                   AND (
                     cancellation.target_id = prior.response_json->>'id' OR
                     cancellation.target_id = 'uuid:' || COALESCE(prior.response_json->>'luxartUuid', '')
                   )
               )
             )
           )
         ORDER BY prior.updated_at DESC
         LIMIT 1`,
        [identity.userId, identity.operation, identity.targetId],
      );
      if (recentApplied.rows[0]) {
        await client.query(
          `INSERT INTO ${mutationTable} (
            user_id, idempotency_key, operation, target_id, request_fingerprint, status, response_json
          ) VALUES ($1, $2, $3, $4, $5, 'applied', $6::jsonb)`,
          [
            identity.userId,
            identity.idempotencyKey,
            identity.operation,
            identity.targetId,
            identity.requestFingerprint,
            JSON.stringify(recentApplied.rows[0].response_json),
          ],
        );
        return new PostgresBookingMutationLease<T>(
          "applied",
          identity,
          client,
          recentApplied.rows[0].response_json as T,
        );
      }

      const unresolved = await client.query<Pick<BookingMutationRow, "status" | "idempotency_key">>(
        `SELECT status, idempotency_key FROM ${mutationTable}
         WHERE user_id = $1 AND operation = $2 AND target_id = $3
           AND status IN ('processing', 'uncertain')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [identity.userId, identity.operation, identity.targetId],
      );
      if (unresolved.rows[0]) {
        if (unresolved.rows[0].status === "processing") {
          await client.query(
            `UPDATE ${mutationTable}
             SET status = 'uncertain', reason_code = 'ORPHANED_PROCESSING', updated_at = now()
             WHERE user_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
            [identity.userId, unresolved.rows[0].idempotency_key],
          );
        }
        return new PostgresBookingMutationLease<T>("uncertain", identity, client);
      }

      await client.query(
        `INSERT INTO ${mutationTable} (
          user_id, idempotency_key, operation, target_id, request_fingerprint, status
        ) VALUES ($1, $2, $3, $4, $5, 'processing')`,
        [identity.userId, identity.idempotencyKey, identity.operation, identity.targetId, identity.requestFingerprint],
      );
      return new PostgresBookingMutationLease<T>("claimed", identity, client);
    } catch (error) {
      if (lockAcquired) {
        await client
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`zone4you-booking-user:${identity.userId}`])
          .catch(() => undefined);
      }
      client.release(error instanceof Error ? error : new Error("Booking ledger acquisition failed."));
      throw error;
    }
  }
}

const globalBookingPool = globalThis as typeof globalThis & { zone4youBookingPool?: Pool };

export function getBookingPool() {
  if (!globalBookingPool.zone4youBookingPool) {
    const configuredPoolMax = Number(process.env.BOOKING_DATABASE_POOL_MAX ?? "5");
    const poolMax = Number.isInteger(configuredPoolMax) ? Math.max(2, Math.min(10, configuredPoolMax)) : 5;
    globalBookingPool.zone4youBookingPool = new Pool({
      connectionString: bookingDatabaseUrl(),
      application_name: "zone4you-booking-mutations",
      max: poolMax,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
    });
  }
  return globalBookingPool.zone4youBookingPool;
}

export function getPostgresBookingMutationLedger() {
  return new PostgresBookingMutationLedger(getBookingPool());
}
