import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadReadonlyRollbackConfig,
  runReadonlyRollbackDrill,
} from "../scripts/verify-readonly-rollback";
import { validateRollbackEvidence } from "../scripts/verify-pilot-release";
import {
  captureReadonlyRollbackTimer,
  readReadonlyRollbackTimerFile,
  readonlyRollbackTimerFingerprint,
} from "../scripts/start-readonly-rollback";

const target = "https://booking.zone4you.cz/";
const commit = "1234567890abcdef1234567890abcdef12345678";
const rollbackStartedAt = new Date("2026-09-05T07:29:45.000Z");
const verificationStartedAt = new Date("2026-09-05T07:29:50.000Z");
const readOnlyVerifiedAt = new Date("2026-09-05T07:30:00.000Z");
function timerFixture(startedAt = rollbackStartedAt) {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-rollback-timer-"));
  const timerPath = join(directory, "timer.json");
  const timerCaptureEnvironment = {
    ZONE4YOU_ROLLBACK_APP_URL: target,
    ZONE4YOU_ROLLBACK_EXPECTED_COMMIT: commit,
    ZONE4YOU_ROLLBACK_TIMER_OUTPUT_PATH: timerPath,
    ZONE4YOU_ROLLBACK_TIMER_CAPTURE_CONFIRMATION: `START_ZONE4YOU_READ_ONLY_ROLLBACK:${readonlyRollbackTimerFingerprint(
      new URL(target),
      commit,
      300_000,
    )}`,
  } satisfies Record<string, string | undefined>;
  const captured = captureReadonlyRollbackTimer({
    environment: timerCaptureEnvironment,
    now: startedAt,
    repositoryRoot: "/repository",
  });
  const environment = {
    ZONE4YOU_ROLLBACK_APP_URL: target,
    ZONE4YOU_ROLLBACK_CONFIRMATION: "READ_ONLY_ROLLBACK:https://booking.zone4you.cz",
    ZONE4YOU_ROLLBACK_EXPECTED_COMMIT: commit,
    ZONE4YOU_ROLLBACK_TIMER_EVIDENCE_PATH: timerPath,
    ZONE4YOU_ROLLBACK_TIMER_VERIFY_CONFIRMATION: `VERIFY_ZONE4YOU_ROLLBACK_TIMER:${captured.evidenceSha256}`,
  } satisfies Record<string, string | undefined>;
  return { captured, directory, environment, timerPath };
}

test("rollback timer capture stores an immutable owner-only start receipt", () => {
  const fixture = timerFixture();
  try {
    assert.equal(fixture.captured.ok, true);
    assert.equal(fixture.captured.evidenceStoredOwnerOnly, true);
    assert.equal(lstatSync(fixture.timerPath).mode & 0o777, 0o600);
    const stored = readReadonlyRollbackTimerFile(fixture.timerPath);
    assert.equal(stored.evidence.startedAt, rollbackStartedAt.toISOString());
    assert.equal(stored.evidence.commit, commit);
    assert.equal(stored.fileSha256, fixture.captured.evidenceSha256);
    assert.throws(
      () => captureReadonlyRollbackTimer({
        environment: {
          ...fixture.environment,
          ZONE4YOU_ROLLBACK_TIMER_OUTPUT_PATH: fixture.timerPath,
          ZONE4YOU_ROLLBACK_TIMER_CAPTURE_CONFIRMATION: `START_ZONE4YOU_READ_ONLY_ROLLBACK:${readonlyRollbackTimerFingerprint(
            new URL(target),
            commit,
            300_000,
          )}`,
        },
        now: rollbackStartedAt,
        repositoryRoot: "/repository",
      }),
      /already exists/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rollback configuration requires an exact target confirmation and secure origin", () => {
  const fixture = timerFixture();
  const oldFixture = timerFixture(new Date("2026-09-05T07:20:00.000Z"));
  try {
    assert.throws(
      () => loadReadonlyRollbackConfig({ ...fixture.environment, ZONE4YOU_ROLLBACK_CONFIRMATION: "YES" }),
      /exactly equal/i,
    );
    assert.throws(
      () => loadReadonlyRollbackConfig({
        ...fixture.environment,
        ZONE4YOU_ROLLBACK_APP_URL: "http://booking.zone4you.cz/",
        ZONE4YOU_ROLLBACK_CONFIRMATION: "READ_ONLY_ROLLBACK:http://booking.zone4you.cz",
      }),
      /requires HTTPS/i,
    );
    assert.equal(loadReadonlyRollbackConfig(fixture.environment, verificationStartedAt).maxDurationMs, 300_000);
    assert.throws(
      () => loadReadonlyRollbackConfig(oldFixture.environment, verificationStartedAt),
      /already exceeded/i,
    );
    chmodSync(fixture.timerPath, 0o640);
    assert.throws(
      () => loadReadonlyRollbackConfig(fixture.environment, verificationStartedAt),
      /must not be accessible/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(oldFixture.directory, { recursive: true, force: true });
  }
});

test("rollback drill proves read-only schedule and every client mutation brake", async () => {
  const fixture = timerFixture();
  const config = loadReadonlyRollbackConfig(fixture.environment, verificationStartedAt);
  let sequence = 0;
  const requests: string[] = [];
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": `rollback-${sequence += 1}` },
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    assert.equal(new Headers(init?.headers).get("origin"), "https://booking.zone4you.cz");
    if (url.pathname === "/api/health") return response({ status: "ok" });
    if (url.pathname === "/api/readiness") {
      return response({
        status: "ready",
        mode: "live",
        phase: "read_only",
        commit,
        region: "fra1",
        luxart: "reachable",
        schedule: "ready",
        booking: "read_only",
        payments: "disabled",
        capabilities: {
          reservationsEnabled: false,
          waitlistEnabled: false,
          topupsEnabled: false,
          topupMode: "disabled",
        },
      });
    }
    if (url.pathname === "/api/booking/snapshot") return response({ lessons: [{ id: "safe-read" }] });
    if (url.pathname === "/api/payments/checkout") {
      return response({ code: "PAYMENTS_DISABLED" }, 503);
    }
    return response({ code: "BOOKING_READ_ONLY" }, 503);
  };

  try {
    const times = [verificationStartedAt, readOnlyVerifiedAt];
    const evidence = await runReadonlyRollbackDrill(config, fakeFetch, () => times.shift()!);
    validateRollbackEvidence(
      evidence,
      config.target.origin,
      commit,
      readReadonlyRollbackTimerFile(fixture.timerPath).evidence,
      fixture.captured.evidenceSha256,
    );
    assert.equal(evidence.ok, true);
    assert.equal(evidence.schemaVersion, 2);
    assert.equal(evidence.recoveryDurationMs, 15_000);
    assert.equal(evidence.verificationDurationMs, 10_000);
    assert.equal(evidence.commit, commit);
    assert.equal(evidence.rollbackTimerSha256, fixture.captured.evidenceSha256);
    assert.equal(evidence.lessonCount, 1);
    assert.equal(evidence.requestIds.length, 7);
    assert.deepEqual(requests, [
      "GET /api/health",
      "GET /api/readiness",
      "GET /api/booking/snapshot",
      "POST /api/reservations",
      "DELETE /api/reservations/rollback-drill-noop",
      "POST /api/waitlist",
      "POST /api/payments/checkout",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rollback drill fails closed when a mutation brake is not active", async () => {
  const fixture = timerFixture();
  const config = loadReadonlyRollbackConfig(fixture.environment, verificationStartedAt);
  let sequence = 0;
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": `unsafe-${sequence += 1}` },
  });
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/api/health") return response({ status: "ok" });
    if (url.pathname === "/api/readiness") {
      return response({
        status: "ready",
        mode: "live",
        phase: "read_only",
        commit,
        region: "fra1",
        luxart: "reachable",
        schedule: "ready",
        booking: "read_only",
        payments: "disabled",
        capabilities: {
          reservationsEnabled: false,
          waitlistEnabled: false,
          topupsEnabled: false,
          topupMode: "disabled",
        },
      });
    }
    if (url.pathname === "/api/booking/snapshot") return response({ lessons: [{ id: "safe-read" }] });
    if (url.pathname === "/api/reservations") return response({ code: "AUTH_REQUIRED" }, 401);
    return response({ code: "BOOKING_READ_ONLY" }, 503);
  };

  try {
    await assert.rejects(
      runReadonlyRollbackDrill(config, fakeFetch, () => verificationStartedAt),
      /was not blocked by BOOKING_READ_ONLY/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rollback drill rejects the wrong deployment before sending sentinel mutations", async () => {
  const fixture = timerFixture();
  const config = loadReadonlyRollbackConfig(fixture.environment, verificationStartedAt);
  const requests: string[] = [];
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": `wrong-${requests.length}` },
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/health") return response({ status: "ok" });
    return response({
      status: "ready",
      mode: "live",
      phase: "read_only",
      commit: "f".repeat(40),
      region: "fra1",
      luxart: "reachable",
      schedule: "ready",
      booking: "read_only",
      payments: "disabled",
      capabilities: {
        reservationsEnabled: false,
        waitlistEnabled: false,
        topupsEnabled: false,
        topupMode: "disabled",
      },
    });
  };

  try {
    await assert.rejects(
      runReadonlyRollbackDrill(config, fakeFetch, () => verificationStartedAt),
      /expected healthy live read-only commit/i,
    );
    assert.deepEqual(requests, ["GET /api/health", "GET /api/readiness"]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
