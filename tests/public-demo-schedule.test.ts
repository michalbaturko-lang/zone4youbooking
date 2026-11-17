import assert from "node:assert/strict";
import test from "node:test";
import source from "../config/public-schedule-snapshot.json";
import { publicDemoLessons, publicDemoScheduleSource, publicDemoScheduleReady, usesPublicDemoSchedule } from "../src/lib/publicDemoSchedule";
import { getMockLuxartState, mockLuxartAdapter, resetMockLuxartState, setMockLuxartState } from "../src/lib/mockLuxart";
import { POST } from "../src/app/api/booking/snapshot/route";
import { GET as readiness } from "../src/app/api/readiness/route";
import { isBookingSnapshotResponse } from "../src/lib/bookingSnapshotValidation";

const names = ["ZONE4YOU_DEMO_SCHEDULE", "LUXART_MOCK", "NEXT_PUBLIC_APP_ENV", "VERCEL_ENV"] as const;
function configure(context: { after: (fn: () => void) => void }) {
  const old = Object.fromEntries(names.map(n => [n, process.env[n]]));
  context.after(() => { for (const n of names) { if (old[n] === undefined) delete process.env[n]; else process.env[n] = old[n]; } resetMockLuxartState(); });
  process.env.ZONE4YOU_DEMO_SCHEDULE = "public_snapshot";
  process.env.LUXART_MOCK = "true";
  process.env.NEXT_PUBLIC_APP_ENV = "demo";
  process.env.VERCEL_ENV = "preview";
  resetMockLuxartState();
}

test("public demo preserves every source occurrence and does not invent prices or instructor photos", (context) => {
  configure(context);
  const lessons = publicDemoLessons();
  assert.equal(lessons.length, source.lessons.length);
  assert.equal(new Set(lessons.map(l => l.id)).size, lessons.length);
  for (const expected of source.lessons) {
    const actual = lessons.find(l => l.id === expected.id)!;
    for (const key of ["name", "startsAt", "endsAt", "durationMinutes", "instructorName", "roomName", "capacity", "occupiedCount", "availableCount"] as const) {
      assert.equal(actual[key], expected[key], `${expected.id}.${key}`);
    }
    assert.equal(actual.pricePublished, false);
    assert.equal(actual.instructorPhoto, undefined);
    assert.equal(Date.parse(actual.endsAt) - Date.parse(actual.startsAt), actual.durationMinutes * 60_000);
  }
  assert.equal(getMockLuxartState().reservations.length, 0);
  assert.equal(getMockLuxartState().waitlist.length, 0);
  assert.equal(getMockLuxartState().transactions.length, 0);
});

test("an old browser schedule cannot restore fabricated bookings or old occupancy into the public snapshot", (context) => {
  delete process.env.ZONE4YOU_DEMO_SCHEDULE;
  resetMockLuxartState();
  const old = getMockLuxartState();
  delete old.scheduleVersion; // Browser state from the previously deployed demo.
  configure(context);
  setMockLuxartState({ ...old, loggedIn: true });
  const recovered = getMockLuxartState();
  assert.equal(recovered.loggedIn, false);
  assert.equal(recovered.reservations.length, 0);
  assert.equal(recovered.occupiedCounts[source.lessons[0].id], source.lessons[0].occupiedCount);
  const local = structuredClone(recovered);
  local.occupiedCounts[source.lessons[0].id] += 1;
  setMockLuxartState(local);
  assert.equal(getMockLuxartState().occupiedCounts[source.lessons[0].id], source.lessons[0].occupiedCount + 1);
  resetMockLuxartState();
  assert.equal(getMockLuxartState().occupiedCounts[source.lessons[0].id], source.lessons[0].occupiedCount);
});

test("public snapshot API returns the exact seven Prague days plus validated provenance", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-17T13:00:00Z") });
  configure(context);
  const response = await POST(new Request("https://booking.example/api/booking/snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(isBookingSnapshotResponse(snapshot), true);
  const expected = source.lessons.filter(l => l.startsAt >= "2026-11-16T23:00:00Z" && l.startsAt < "2026-11-23T23:00:00Z");
  assert.deepEqual(snapshot.lessons.map((l: { id: string }) => l.id).sort(), expected.map(l => l.id).sort());
  assert.equal(snapshot.demoSchedule.capturedAt, source.capturedAt);
  assert.equal(snapshot.demoSchedule.url, source.sourceUrl);
  assert.equal(snapshot.reservations.length, 0);
  const ready = await (await readiness()).json();
  assert.equal(ready.mode, "demo");
  assert.equal(ready.schedule, "public_snapshot");
  assert.equal(ready.demoSchedule.version, snapshot.demoSchedule.version);
  assert.equal(isBookingSnapshotResponse({ ...snapshot, demoSchedule: { ...snapshot.demoSchedule, url: "javascript:alert(1)" } }), false);
  assert.equal(isBookingSnapshotResponse({ ...snapshot, lessons: [{ ...snapshot.lessons[0], pricePublished: "false" }] }), false);
});

test("a public demo switch cannot replace live Luxart data", (context) => {
  configure(context);
  process.env.LUXART_MOCK = "false";
  assert.equal(usesPublicDemoSchedule(), false);
  assert.equal(publicDemoScheduleSource(), undefined);
});


test("an expired public snapshot cannot claim a complete current week", async (context) => {
  configure(context);
  assert.equal(publicDemoScheduleReady(new Date("2026-11-23T12:00:00Z")), true);
  assert.equal(publicDemoScheduleReady(new Date("2026-11-24T12:00:00Z")), false);
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-24T12:00:00Z") });
  const response = await readiness();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).schedule, "public_snapshot_expired");
});
