import assert from "node:assert/strict";
import test from "node:test";
import {
  addZone4YouCalendarDays,
  zone4YouDateKey,
  zone4YouScheduleRange,
  zone4YouStartOfDay,
} from "../src/lib/zone4YouTime";

test("Zone4You calendar uses Europe/Prague at summer and winter midnight boundaries", () => {
  assert.equal(zone4YouDateKey("2026-08-30T21:59:59.000Z"), "2026-08-30");
  assert.equal(zone4YouDateKey("2026-08-30T22:00:00.000Z"), "2026-08-31");
  assert.equal(zone4YouDateKey("2026-01-01T22:59:59.000Z"), "2026-01-01");
  assert.equal(zone4YouDateKey("2026-01-01T23:00:00.000Z"), "2026-01-02");
});

test("calendar-day arithmetic remains stable across daylight-saving changes", () => {
  assert.equal(addZone4YouCalendarDays("2026-03-27", 7), "2026-04-03");
  assert.equal(addZone4YouCalendarDays("2026-10-23", 7), "2026-10-30");
  const springRange = zone4YouScheduleRange(new Date("2026-03-28T23:30:00.000Z"), 7);
  const autumnRange = zone4YouScheduleRange(new Date("2026-10-24T22:30:00.000Z"), 7);
  assert.deepEqual(springRange, {
    from: "2026-03-29T00:00:00.000Z",
    to: "2026-04-05T00:00:00.000Z",
  });
  assert.deepEqual(autumnRange, {
    from: "2026-10-25T00:00:00.000Z",
    to: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(new Date(springRange.to).getTime() - new Date(springRange.from).getTime(), 7 * 86_400_000);
  assert.equal(new Date(autumnRange.to).getTime() - new Date(autumnRange.from).getTime(), 7 * 86_400_000);
});

test("lesson-day midnight resolves to the Prague instant across daylight-saving changes", () => {
  assert.equal(zone4YouStartOfDay("2026-01-15"), "2026-01-14T23:00:00.000Z");
  assert.equal(zone4YouStartOfDay("2026-07-15"), "2026-07-14T22:00:00.000Z");
  assert.equal(zone4YouStartOfDay("2026-03-29"), "2026-03-28T23:00:00.000Z");
  assert.equal(zone4YouStartOfDay("2026-10-25"), "2026-10-24T22:00:00.000Z");
});

test("calendar helpers reject invalid dates and unbounded ranges", () => {
  assert.throws(() => zone4YouDateKey("not-a-date"), /invalid/i);
  assert.throws(() => addZone4YouCalendarDays("2026-02-30", 1), /invalid/i);
  assert.throws(() => zone4YouStartOfDay("2026-02-30"), /invalid/i);
  assert.throws(() => zone4YouScheduleRange(new Date(), 32), /1 to 31/i);
});
