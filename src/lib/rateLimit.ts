import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Pool } from "pg";
import { BookingApiError } from "./errors";
import { validTlsPostgresUrl } from "./paymentConfig";

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowMs: number;
  keyBy?: "address" | "address-and-discriminator" | "discriminator";
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface PostgresRateLimitRow {
  request_count: number;
  retry_after_seconds: number;
}

const rateLimitTable = "zone4you_rate_limit_buckets";
const rateLimitSchemaTable = "zone4you_rate_limit_schema";
const rateLimitSchemaVersion = 1;
const postgresCleanupBatchSize = 100;
const postgresCleanupGraceMs = 60 * 60_000;

export class InMemoryFixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxBuckets = 20_000) {}

  take(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
    this.prune(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxBuckets) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(rule.windowMs / 1000)),
        };
      }
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(key, bucket);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterSeconds,
    };
  }

  private prune(now: number) {
    if (this.buckets.size < this.maxBuckets / 2) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export class PostgresFixedWindowRateLimiter {
  constructor(private readonly pool: Pool) {}

  async assertReady() {
    const result = await this.pool.query<{ table_name: string | null; schema_table_name: string | null }>(
      `SELECT
        to_regclass('${rateLimitTable}')::text AS table_name,
        to_regclass('${rateLimitSchemaTable}')::text AS schema_table_name`,
    );
    if (
      result.rows[0]?.table_name !== rateLimitTable ||
      result.rows[0]?.schema_table_name !== rateLimitSchemaTable
    ) {
      throw new BookingApiError(503, "RATE_LIMIT_NOT_READY", "Ochrana proti zneužití není připravena.");
    }
    const schema = await this.pool.query<{
      version: number;
      version_rows: number;
      bucket_primary_key_valid: boolean;
    }>(
      `SELECT
        COALESCE((SELECT MAX(version) FROM ${rateLimitSchemaTable}), 0)::int AS version,
        (SELECT COUNT(*) FROM ${rateLimitSchemaTable})::int AS version_rows,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = to_regclass('${rateLimitTable}')
            AND contype = 'p'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (bucket_key)'
        ) AS bucket_primary_key_valid`,
    );
    if (
      schema.rows[0]?.version !== rateLimitSchemaVersion ||
      schema.rows[0]?.version_rows !== 1 ||
      schema.rows[0]?.bucket_primary_key_valid !== true
    ) {
      throw new BookingApiError(503, "RATE_LIMIT_NOT_READY", "Ochrana proti zneužití má neplatnou verzi.");
    }
  }

  async take(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const result = await this.pool.query<PostgresRateLimitRow>(
      `WITH observed AS (
         SELECT clock_timestamp() AS observed_at
       ), expired AS (
         SELECT bucket_key
         FROM ${rateLimitTable}, observed
         WHERE reset_at <= observed_at - ($5::bigint * interval '1 millisecond')
           AND bucket_key <> $1
         ORDER BY reset_at, bucket_key
         LIMIT $6::integer
         FOR UPDATE SKIP LOCKED
       ), pruned AS (
         DELETE FROM ${rateLimitTable} AS buckets
         USING expired
         WHERE buckets.bucket_key = expired.bucket_key
         RETURNING buckets.bucket_key
       ), upserted AS (
         INSERT INTO ${rateLimitTable} (bucket_key, scope, request_count, reset_at, updated_at)
         SELECT $1, $2, 1, observed_at + ($3::bigint * interval '1 millisecond'), observed_at
         FROM observed
         ON CONFLICT (bucket_key) DO UPDATE SET
           scope = EXCLUDED.scope,
           request_count = CASE
             WHEN ${rateLimitTable}.reset_at <= EXCLUDED.updated_at THEN 1
             ELSE LEAST(${rateLimitTable}.request_count + 1, $4::integer + 1)
           END,
           reset_at = CASE
             WHEN ${rateLimitTable}.reset_at <= EXCLUDED.updated_at THEN EXCLUDED.reset_at
             ELSE ${rateLimitTable}.reset_at
           END,
           updated_at = EXCLUDED.updated_at
         RETURNING request_count, reset_at
       )
       SELECT
         request_count::int,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - clock_timestamp()))))::int AS retry_after_seconds
       FROM upserted
       CROSS JOIN (SELECT COUNT(*) FROM pruned) AS cleanup`,
      [key, rule.scope, rule.windowMs, rule.limit, postgresCleanupGraceMs, postgresCleanupBatchSize],
    );
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL rate limiter did not return a bucket.");
    return {
      allowed: row.request_count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.request_count),
      retryAfterSeconds: row.retry_after_seconds,
    };
  }
}

const globalRateLimitState = globalThis as typeof globalThis & {
  zone4youRateLimiter?: InMemoryFixedWindowRateLimiter;
};

const rateLimiter = globalRateLimitState.zone4youRateLimiter ?? new InMemoryFixedWindowRateLimiter();
globalRateLimitState.zone4youRateLimiter = rateLimiter;

const globalPostgresRateLimitState = globalThis as typeof globalThis & {
  zone4youRateLimitPool?: Pool;
  zone4youPostgresRateLimiter?: PostgresFixedWindowRateLimiter;
};

export const rateLimitRules = {
  scheduleRead: { scope: "schedule-read", limit: 120, windowMs: 60_000 },
  accountRead: { scope: "account-read", limit: 120, windowMs: 60_000 },
  loginDemo: { scope: "auth-login-demo", limit: 5, windowMs: 10 * 60_000 },
  loginAddress: {
    scope: "auth-login-address",
    limit: 30,
    windowMs: 10 * 60_000,
    keyBy: "address",
  },
  loginAccount: {
    scope: "auth-login-account",
    limit: 15,
    windowMs: 10 * 60_000,
    keyBy: "discriminator",
  },
  reservationCreate: { scope: "reservation-create", limit: 12, windowMs: 60_000 },
  reservationCancel: { scope: "reservation-cancel", limit: 12, windowMs: 60_000 },
  waitlistJoin: { scope: "waitlist-join", limit: 12, windowMs: 60_000 },
  waitlistLeave: { scope: "waitlist-leave", limit: 12, windowMs: 60_000 },
  topup: { scope: "topup-create", limit: 5, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;

function validForwardedAddress(value: string | null) {
  const candidate = value?.split(",", 1)[0]?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : undefined;
}

export function clientAddress(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
) {
  const vercelRuntime = environment.VERCEL === "1" || Boolean(environment.VERCEL_ENV);
  if (vercelRuntime) {
    return validForwardedAddress(request.headers.get("x-vercel-forwarded-for")) ?? "unknown";
  }
  return validForwardedAddress(request.headers.get("x-forwarded-for")) ??
    validForwardedAddress(request.headers.get("x-real-ip")) ??
    "unknown";
}

export function rateLimitKey(request: Request, rule: RateLimitRule, discriminator = "") {
  const normalizedDiscriminator = discriminator
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("cs-CZ")
    .slice(0, 256);
  const identity = rule.keyBy === "address"
    ? clientAddress(request)
    : rule.keyBy === "discriminator"
      ? normalizedDiscriminator
      : `${clientAddress(request)}|${normalizedDiscriminator}`;
  return createHash("sha256")
    .update(`${rule.scope}|${identity}`)
    .digest("base64url");
}

export function rateLimitConfigurationProblems(environment: Record<string, string | undefined> = process.env) {
  const live = environment.LUXART_MOCK === "false";
  const mode = environment.RATE_LIMIT_MODE ?? (live ? "" : "memory");
  const problems: string[] = [];
  if (!["memory", "postgres"].includes(mode)) problems.push("RATE_LIMIT_MODE");
  if (mode === "memory" && live && environment.RATE_LIMIT_SINGLE_INSTANCE !== "true") {
    problems.push("RATE_LIMIT_SINGLE_INSTANCE");
  }
  if (mode === "postgres" && !validTlsPostgresUrl(environment.RATE_LIMIT_DATABASE_URL)) {
    problems.push("RATE_LIMIT_DATABASE_URL");
  }
  return problems;
}

export function rateLimitRuntimeReady(environment: Record<string, string | undefined> = process.env) {
  return rateLimitConfigurationProblems(environment).length === 0;
}

function configuredRateLimitMode() {
  const live = process.env.LUXART_MOCK === "false";
  const mode = process.env.RATE_LIMIT_MODE ?? (live ? "" : "memory");
  if (!rateLimitRuntimeReady()) {
    throw new BookingApiError(503, "RATE_LIMIT_NOT_READY", "Ochrana proti zneužití není připravena.");
  }
  return mode as "memory" | "postgres";
}

export function getPostgresRateLimiter() {
  if (!globalPostgresRateLimitState.zone4youRateLimitPool) {
    const configuredPoolMax = Number(process.env.RATE_LIMIT_DATABASE_POOL_MAX ?? "2");
    const poolMax = Number.isInteger(configuredPoolMax) ? Math.max(1, Math.min(5, configuredPoolMax)) : 2;
    globalPostgresRateLimitState.zone4youRateLimitPool = new Pool({
      connectionString: process.env.RATE_LIMIT_DATABASE_URL,
      application_name: "zone4you-rate-limit",
      max: poolMax,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 10_000,
    });
  }
  if (!globalPostgresRateLimitState.zone4youPostgresRateLimiter) {
    globalPostgresRateLimitState.zone4youPostgresRateLimiter = new PostgresFixedWindowRateLimiter(
      globalPostgresRateLimitState.zone4youRateLimitPool,
    );
  }
  return globalPostgresRateLimitState.zone4youPostgresRateLimiter;
}

export async function assertRateLimit(request: Request, rule: RateLimitRule, discriminator = "") {
  let result: RateLimitResult;
  try {
    const key = rateLimitKey(request, rule, discriminator);
    result = configuredRateLimitMode() === "postgres"
      ? await getPostgresRateLimiter().take(key, rule)
      : rateLimiter.take(key, rule);
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw new BookingApiError(503, "RATE_LIMIT_UNAVAILABLE", "Ochranu proti zneužití nelze ověřit. Zkuste to později.");
  }
  if (result.allowed) return result;
  throw new BookingApiError(
    429,
    "RATE_LIMITED",
    "Příliš mnoho požadavků. Zkuste to prosím později.",
    { "Retry-After": String(result.retryAfterSeconds) },
  );
}
