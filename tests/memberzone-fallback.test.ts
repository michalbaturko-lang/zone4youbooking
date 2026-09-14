import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  memberzoneFallbackUrl,
  verifyMemberzoneFallback,
} from "../scripts/verify-memberzone-fallback";

const now = new Date("2026-09-12T14:15:00.000Z");

function schedulerHtml(overrides: {
  scheduler?: boolean;
  signIn?: boolean;
  appointments?: boolean;
  reformer?: boolean;
} = {}) {
  const enabled = {
    scheduler: true,
    signIn: true,
    appointments: true,
    reformer: true,
    ...overrides,
  };
  return `<!doctype html><html><head><title>EMA - Rezervační systém</title></head><body>
    ${enabled.scheduler ? '<script src="/ZONE4YOU/scheduler.js">ASPxClientScheduler</script>' : ""}
    ${enabled.signIn ? '<a href="Account/SignIn.aspx">Přihlášení</a>' : ""}
    ${enabled.appointments ? "<script>const data = {'apts':[{'name':'Sensitive Instructor'}]};</script>" : ""}
    ${enabled.reformer ? "<span>REFORMER</span>" : ""}
  </body></html>`;
}

function htmlResponse(body = schedulerHtml(), init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

test("Memberzone fallback verifier stores only privacy-safe owner evidence for the exact scheduler", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-memberzone-"));
  chmodSync(directory, 0o700);
  try {
    const outputPath = join(directory, "memberzone.json");
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const receipt = await verifyMemberzoneFallback({
      environment: { ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH: outputPath },
      now,
      repositoryRoot: "/repository",
      fetchImpl: async (url, init) => {
        observedUrl = url.href;
        observedInit = init;
        return htmlResponse();
      },
    });

    assert.equal(observedUrl, memberzoneFallbackUrl.href);
    assert.equal(observedInit?.method, "GET");
    assert.equal(observedInit?.redirect, "manual");
    const headers = new Headers(observedInit?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.httpStatus, 200);
    assert.equal(receipt.schedulerDetected, true);
    assert.equal(receipt.nonEmptyScheduleDetected, true);
    assert.equal(receipt.reformerDetected, true);
    assert.match(receipt.evidenceSha256, /^[a-f0-9]{64}$/);
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const stored = readFileSync(outputPath, "utf8");
    assert.doesNotMatch(stored, /Sensitive Instructor|apts/i);
    const evidence = JSON.parse(stored) as Record<string, unknown>;
    assert.equal(evidence.target, memberzoneFallbackUrl.href);
    assert.equal(evidence.transport, "https");
    assert.equal(evidence.signInPathDetected, true);
    assert.match(String(evidence.bodySha256), /^[a-f0-9]{64}$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Memberzone fallback verifier rejects redirects, invalid content and empty schedules without evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-memberzone-"));
  chmodSync(directory, 0o700);
  try {
    const cases: Array<[string, () => Promise<Response>, RegExp]> = [
      ["redirect", async () => new Response("", { status: 302, headers: { location: "https://example.com" } }), /HTTP status 302/i],
      ["json", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), /did not return HTML/i],
      ["empty", async () => htmlResponse(schedulerHtml({ appointments: false })), /expected non-empty Zone4You schedule/i],
      ["no-reformer", async () => htmlResponse(schedulerHtml({ reformer: false })), /expected non-empty Zone4You schedule/i],
      ["oversized", async () => htmlResponse("", { headers: { "content-type": "text/html", "content-length": "600000" } }), /unexpectedly large/i],
    ];
    for (const [name, fetchImpl, expected] of cases) {
      const outputPath = join(directory, `${name}.json`);
      await assert.rejects(
        verifyMemberzoneFallback({
          environment: { ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH: outputPath },
          repositoryRoot: "/repository",
          fetchImpl,
        }),
        expected,
      );
      assert.equal(existsSync(outputPath), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Memberzone fallback verifier requires a bounded timeout and protected external output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-memberzone-"));
  chmodSync(directory, 0o700);
  try {
    await assert.rejects(
      verifyMemberzoneFallback({
        environment: {
          ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH: join(directory, "timeout.json"),
          ZONE4YOU_MEMBERZONE_TIMEOUT_MS: "999",
        },
        repositoryRoot: "/repository",
        fetchImpl: async () => htmlResponse(),
      }),
      /integer from 1000 to 30000/i,
    );
    await assert.rejects(
      verifyMemberzoneFallback({
        environment: { ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH: "/repository/memberzone.json" },
        repositoryRoot: "/repository",
        fetchImpl: async () => htmlResponse(),
      }),
      /outside the repository/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
