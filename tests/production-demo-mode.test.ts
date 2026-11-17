import assert from "node:assert/strict";
import test from "node:test";
import { getLuxartAdapter } from "../src/lib/adapterProvider";
import { mockLuxartAdapter } from "../src/lib/mockLuxart";
import { GET } from "../src/app/api/readiness/route";

const names = ["LUXART_MOCK", "NEXT_PUBLIC_APP_ENV", "VERCEL_ENV"] as const;

test("production hosting serves mock only with both explicit demo settings", (context) => {
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  context.after(() => { for (const name of names) { const value = previous[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.VERCEL_ENV = "production";
  for (const [mock, app] of [[undefined, undefined], ["true", undefined], [undefined, "demo"], ["true", "staging"], ["true", "production"]]) {
    if (mock === undefined) delete process.env.LUXART_MOCK; else process.env.LUXART_MOCK = mock;
    if (app === undefined) delete process.env.NEXT_PUBLIC_APP_ENV; else process.env.NEXT_PUBLIC_APP_ENV = app;
    assert.throws(() => getLuxartAdapter());
  }
  process.env.LUXART_MOCK = "true";
  process.env.NEXT_PUBLIC_APP_ENV = "demo";
  assert.equal(getLuxartAdapter(), mockLuxartAdapter);
  process.env.NEXT_PUBLIC_APP_ENV = "production";
  process.env.VERCEL_ENV = "preview";
  assert.throws(() => getLuxartAdapter());
});

test("readiness rejects the same invalid production mock configuration as the adapter", async (context) => {
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  context.after(() => { for (const name of names) { const value = previous[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.VERCEL_ENV = "production";
  process.env.LUXART_MOCK = "true";
  delete process.env.NEXT_PUBLIC_APP_ENV;
  const rejected = await GET();
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).status, "not_ready");
  process.env.NEXT_PUBLIC_APP_ENV = "demo";
  const accepted = await GET();
  assert.equal(accepted.status, 200);
  const payload = await accepted.json();
  assert.equal(payload.status, "ready");
  assert.equal(payload.mode, "demo");
  assert.equal(payload.luxart, "mock");
});
