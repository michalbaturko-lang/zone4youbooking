import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/readiness/route";

const commit = "1234567890abcdef1234567890abcdef12345678";
const environmentNames = [
  "LUXART_MOCK",
  "VERCEL_GIT_COMMIT_SHA",
  "ZONE4YOU_DEPLOYMENT_COMMIT",
  "VERCEL_REGION",
] as const;

test("demo readiness exposes immutable deployment provenance without claiming live readiness", async () => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  try {
    process.env.LUXART_MOCK = "true";
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.ZONE4YOU_DEPLOYMENT_COMMIT = commit.toUpperCase();
    process.env.VERCEL_REGION = " FRA1 ";

    const response = await GET();
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.mode, "demo");
    assert.equal(body.phase, "demo");
    assert.equal(body.commit, commit);
    assert.equal(body.region, "fra1");
    assert.equal(body.luxart, "mock");
    assert.equal(body.schedule, "mock");
  } finally {
    for (const name of environmentNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("demo readiness marks missing deployment provenance as unverified", async () => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  try {
    process.env.LUXART_MOCK = "true";
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.ZONE4YOU_DEPLOYMENT_COMMIT;
    delete process.env.VERCEL_REGION;

    const response = await GET();
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.commit, "unverified");
    assert.equal(body.region, "unknown");
    assert.equal(body.mode, "demo");
  } finally {
    for (const name of environmentNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
