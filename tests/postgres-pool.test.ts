import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimePostgresPool } from "../src/lib/postgresPool";

test("idle database errors are handled without reflecting credentials or killing the process", async (context) => {
  const events: unknown[] = [];
  context.mock.method(console, "error", (value: string) => { events.push(JSON.parse(value)); });
  const pool = createRuntimePostgresPool({ max: 1 }, "booking");
  assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("private-db-url-marker"), { code: "57P01" })));
  assert.deepEqual(events, [{ event: "booking_database_pool_error", component: "booking", code: "57P01" }]);
  assert.equal(JSON.stringify(events).includes("private-db-url-marker"), false);
  await pool.end();
});
