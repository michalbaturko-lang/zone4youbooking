import { pathToFileURL } from "node:url";
import type { BookingCapabilities } from "../src/lib/domain";

type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export interface ReadonlyRollbackConfig {
  target: URL;
  timeoutMs: number;
  maxDurationMs: number;
}

interface ApiResult<T> {
  body: T;
  requestId: string;
  status: number;
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boundedInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function loadReadonlyRollbackConfig(environment: Environment = process.env): ReadonlyRollbackConfig {
  const target = new URL(required(environment, "ZONE4YOU_ROLLBACK_APP_URL"));
  if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("ZONE4YOU_ROLLBACK_APP_URL must be a clean origin ending in / without credentials, query or hash.");
  }

  const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  if (target.protocol !== "https:" && !(local && environment.ZONE4YOU_ROLLBACK_ALLOW_LOCAL_HTTP === "true")) {
    throw new Error("Rollback verification requires HTTPS; local HTTP needs ZONE4YOU_ROLLBACK_ALLOW_LOCAL_HTTP=true.");
  }

  const expectedConfirmation = `READ_ONLY_ROLLBACK:${target.origin}`;
  if (environment.ZONE4YOU_ROLLBACK_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_ROLLBACK_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const timeoutMs = boundedInteger(environment, "ZONE4YOU_ROLLBACK_TIMEOUT_MS", 12_000, 1_000, 30_000);
  const maxDurationSeconds = boundedInteger(environment, "ZONE4YOU_ROLLBACK_MAX_SECONDS", 300, 10, 300);
  return { target, timeoutMs, maxDurationMs: maxDurationSeconds * 1_000 };
}

async function api<T>(
  config: ReadonlyRollbackConfig,
  fetchImpl: FetchLike,
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetchImpl(new URL(path, config.target), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: config.target.origin,
      "X-Zone4You-Locale": "cs",
      ...init.headers,
    },
  });
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error(`${init.method ?? "GET"} ${path} did not return X-Request-ID.`);
  const body = (await response.json().catch(() => ({}))) as T;
  return { body, requestId, status: response.status };
}

function assertOk(result: ApiResult<{ status?: string }>, path: string, expectedStatus: string) {
  if (result.status !== 200 || result.body.status !== expectedStatus) {
    throw new Error(`${path} did not return the expected ${expectedStatus} state.`);
  }
}

function assertBlocked(
  result: ApiResult<{ code?: string }>,
  operation: string,
  expectedCode: "BOOKING_READ_ONLY" | "PAYMENTS_DISABLED",
) {
  if (result.status !== 503 || result.body.code !== expectedCode) {
    throw new Error(`${operation} was not blocked by ${expectedCode}; stop the rollback drill.`);
  }
}

export async function runReadonlyRollbackDrill(
  config: ReadonlyRollbackConfig,
  fetchImpl: FetchLike = fetch,
) {
  const startedAt = Date.now();
  const requestIds: string[] = [];

  const health = await api<{ status?: string }>(config, fetchImpl, "/api/health");
  requestIds.push(health.requestId);
  assertOk(health, "/api/health", "ok");

  const readiness = await api<{
    status?: string;
    mode?: string;
    luxart?: string;
    booking?: string;
    payments?: string;
    capabilities?: Partial<BookingCapabilities>;
  }>(config, fetchImpl, "/api/readiness");
  requestIds.push(readiness.requestId);
  const capabilities = readiness.body.capabilities;
  if (
    readiness.status !== 200 ||
    readiness.body.status !== "ready" ||
    readiness.body.mode !== "live" ||
    readiness.body.luxart !== "reachable" ||
    readiness.body.booking !== "read_only" ||
    readiness.body.payments !== "disabled" ||
    capabilities?.reservationsEnabled !== false ||
    capabilities.waitlistEnabled !== false ||
    capabilities.topupsEnabled !== false ||
    capabilities.topupMode !== "disabled"
  ) {
    throw new Error("Target is not a healthy live read-only runtime with booking, waitlist and payments disabled.");
  }

  const snapshot = await api<{ lessons?: unknown[] }>(config, fetchImpl, "/api/booking/snapshot");
  requestIds.push(snapshot.requestId);
  if (snapshot.status !== 200 || !Array.isArray(snapshot.body.lessons) || snapshot.body.lessons.length === 0) {
    throw new Error("Read-only schedule snapshot is unavailable or empty.");
  }

  const reservation = await api<{ code?: string }>(config, fetchImpl, "/api/reservations", {
    method: "POST",
    headers: { "Idempotency-Key": "rollback-drill-create-noop" },
    body: JSON.stringify({ lessonId: "rollback-drill-noop" }),
  });
  requestIds.push(reservation.requestId);
  assertBlocked(reservation, "Reservation creation", "BOOKING_READ_ONLY");

  const cancellation = await api<{ code?: string }>(config, fetchImpl, "/api/reservations/rollback-drill-noop", {
    method: "DELETE",
    headers: { "Idempotency-Key": "rollback-drill-cancel-noop" },
    body: "{}",
  });
  requestIds.push(cancellation.requestId);
  assertBlocked(cancellation, "Reservation cancellation", "BOOKING_READ_ONLY");

  const waitlist = await api<{ code?: string }>(config, fetchImpl, "/api/waitlist", {
    method: "POST",
    body: JSON.stringify({ lessonId: "rollback-drill-noop" }),
  });
  requestIds.push(waitlist.requestId);
  assertBlocked(waitlist, "Waitlist creation", "BOOKING_READ_ONLY");

  const checkout = await api<{ code?: string }>(config, fetchImpl, "/api/payments/checkout", {
    method: "POST",
    body: JSON.stringify({ amountKc: 500 }),
  });
  requestIds.push(checkout.requestId);
  assertBlocked(checkout, "Stripe Checkout", "PAYMENTS_DISABLED");

  const durationMs = Date.now() - startedAt;
  if (durationMs > config.maxDurationMs) {
    throw new Error(`Rollback verification took ${durationMs} ms, above the ${config.maxDurationMs} ms limit.`);
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    target: config.target.origin,
    durationMs,
    maximumDurationMs: config.maxDurationMs,
    lessonCount: snapshot.body.lessons.length,
    healthReady: true,
    luxartReadable: true,
    bookingReadOnly: true,
    waitlistReadOnly: true,
    paymentsDisabled: true,
    requestIds,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runReadonlyRollbackDrill(loadReadonlyRollbackConfig())
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error: unknown) => {
      console.error(`Rollback verification failed: ${error instanceof Error ? error.message : "Unknown error."}`);
      process.exitCode = 1;
    });
}
