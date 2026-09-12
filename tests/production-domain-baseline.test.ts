import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  captureProductionDomainBaseline,
  loadProductionDomainBaselineCaptureConfig,
  normalizeProductionDnsRecords,
  resolveProductionDnsRecords,
} from "../scripts/capture-production-domain-baseline";
import { verifyProductionDomainBaseline } from "../scripts/verify-production-domain-baseline";

const hostname = "booking.zone4you.cz";
const now = new Date("2026-09-11T14:00:00.000Z");
const records = [
  { type: "AAAA" as const, address: "2001:db8::10", ttl: 300 },
  { type: "A" as const, address: "203.0.113.10", ttl: 300 },
];

function captureEnvironment(path: string) {
  return {
    ZONE4YOU_DNS_BASELINE_OUTPUT_PATH: path,
    ZONE4YOU_DNS_BASELINE_CAPTURE_CONFIRMATION: `CAPTURE_ZONE4YOU_DNS_BASELINE:${hostname}`,
  };
}

test("DNS rollback capture requires an explicit target and a protected external output", () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-dns-baseline-"));
  try {
    const outputPath = join(directory, "baseline.json");
    assert.deepEqual(loadProductionDomainBaselineCaptureConfig(captureEnvironment(outputPath), "/repository"), {
      hostname,
      outputPath,
    });
    assert.throws(
      () => loadProductionDomainBaselineCaptureConfig({
        ...captureEnvironment(outputPath),
        ZONE4YOU_DNS_BASELINE_CAPTURE_CONFIRMATION: "YES",
      }, "/repository"),
      /must exactly equal/i,
    );
    assert.throws(
      () => loadProductionDomainBaselineCaptureConfig(captureEnvironment("/repository/baseline.json"), "/repository"),
      /outside the repository/i,
    );
    writeFileSync(outputPath, "{}", "utf8");
    assert.throws(
      () => loadProductionDomainBaselineCaptureConfig(captureEnvironment(outputPath), "/repository"),
      /already exists/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DNS rollback capture stores exact records owner-only while the receipt hides addresses", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-dns-baseline-"));
  try {
    const outputPath = join(directory, "baseline.json");
    const receipt = await captureProductionDomainBaseline({
      environment: captureEnvironment(outputPath),
      now,
      repositoryRoot: "/repository",
      resolveRecordsImpl: async () => [...records, records[1]],
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.recordCount, 2);
    assert.deepEqual(receipt.recordTypes, ["A", "AAAA"]);
    assert.equal(receipt.evidenceStoredOwnerOnly, true);
    assert.equal(JSON.stringify(receipt).includes("203.0.113.10"), false);
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const stored = JSON.parse(readFileSync(outputPath, "utf8")) as { records: unknown[]; rollbackReady: boolean };
    assert.equal(stored.records.length, 2);
    assert.equal(stored.rollbackReady, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DNS rollback verifier stops cutover when the public record set drifted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-dns-baseline-"));
  try {
    const outputPath = join(directory, "baseline.json");
    const captured = await captureProductionDomainBaseline({
      environment: captureEnvironment(outputPath),
      now,
      repositoryRoot: "/repository",
      resolveRecordsImpl: async () => records,
    });
    const environment = {
      ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH: outputPath,
      ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION: `VERIFY_ZONE4YOU_DNS_BASELINE:${captured.evidenceSha256}`,
    };
    const verified = await verifyProductionDomainBaseline({
      environment,
      now,
      resolveRecordsImpl: async () => [...records].reverse().map((record) => ({ ...record, ttl: 30 })),
    });
    assert.equal(verified.unchangedSinceCapture, true);
    await assert.rejects(
      verifyProductionDomainBaseline({
        environment,
        now: new Date("2026-09-12T14:00:01.000Z"),
        resolveRecordsImpl: async () => records,
      }),
      /no more than 24 hours old/i,
    );
    await assert.rejects(
      verifyProductionDomainBaseline({
        environment,
        now,
        resolveRecordsImpl: async () => [{ type: "A", address: "203.0.113.11", ttl: 30 }],
      }),
      /changed after the rollback baseline/i,
    );
    await assert.rejects(
      verifyProductionDomainBaseline({
        environment: { ...environment, ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION: "YES" },
        now,
        resolveRecordsImpl: async () => records,
      }),
      /must exactly equal/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DNS rollback capture rejects unsafe parent permissions and missing address records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-dns-baseline-"));
  try {
    chmodSync(directory, 0o755);
    const outputPath = join(directory, "baseline.json");
    assert.throws(
      () => loadProductionDomainBaselineCaptureConfig(captureEnvironment(outputPath), "/repository"),
      /must not be accessible/i,
    );
    chmodSync(directory, 0o700);
    await assert.rejects(
      captureProductionDomainBaseline({
        environment: captureEnvironment(outputPath),
        now,
        repositoryRoot: "/repository",
        resolveRecordsImpl: async () => [{ type: "MX", exchange: "mail.example.com", priority: 10 }],
      }),
      /no A, AAAA or CNAME/i,
    );
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production DNS resolution queries A, AAAA and CNAME explicitly", async () => {
  const noData = Object.assign(new Error("No data"), { code: "ENODATA" });
  const resolved = await resolveProductionDnsRecords(hostname, {
    resolve4Impl: async () => [{ address: "203.0.113.10", ttl: 300 }],
    resolve6Impl: async () => [{ address: "2001:db8::10", ttl: 300 }],
    resolveCnameImpl: async () => Promise.reject(noData),
  });
  assert.deepEqual(normalizeProductionDnsRecords(resolved), normalizeProductionDnsRecords(records));
});
