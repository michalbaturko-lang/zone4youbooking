import assert from "node:assert/strict";
import source from "../config/public-schedule-snapshot.json";
import { zone4YouScheduleRange } from "../src/lib/zone4YouTime";

async function main() {
const raw = process.env.APP_BASE_URL ?? "http://127.0.0.1:3012";
const target = new URL(raw);
const local = ["127.0.0.1", "localhost"].includes(target.hostname);
assert.equal(target.origin, raw, "APP_BASE_URL must be a clean origin without a trailing slash.");
assert.ok(local || (target.protocol === "https:" && /^zone4youbooking(?:-[a-z0-9-]+-mbos-projects-220653ae)?\.vercel\.app$/.test(target.hostname)), "Only an explicit local or Zone4you demo target is allowed.");
const commit = process.env.ZONE4YOU_EXPECTED_DEMO_COMMIT;
if (!local) assert.match(commit ?? "", /^[a-f0-9]{40}$/, "An exact deployed commit is required.");
async function json(path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, target), { ...init, redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json", "Content-Type": "application/json" } });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
}
const ready = await json("/api/readiness");
assert.equal(ready.mode, "demo");
assert.equal(ready.luxart, "mock");
assert.equal(ready.schedule, "public_snapshot");
assert.equal(ready.demoSchedule?.capturedAt, source.capturedAt);
assert.equal(ready.demoSchedule?.url, source.sourceUrl);
if (commit) assert.equal(ready.commit, commit);
// This read endpoint restores an isolated empty browser demo state. It never
// calls a live club mutation; the explicit demo guard above must pass first.
const snapshot = await json("/api/booking/snapshot", { method: "POST", body: "{}" });
const range = zone4YouScheduleRange(new Date(), 7);
const expected = source.lessons.filter(l => l.startsAt >= range.from && l.startsAt < range.to);
assert.ok(expected.length > 0, "The captured public schedule has expired; refresh it explicitly.");
const fields = ["id", "name", "startsAt", "endsAt", "durationMinutes", "instructorName", "roomName", "capacity", "occupiedCount", "availableCount"] as const;
const project = (rows: Array<Record<string, unknown>>) => rows.map(row => Object.fromEntries(fields.map(key => [key, row[key]]))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
assert.deepEqual(project(snapshot.lessons), project(expected), "Deployed lessons differ from the captured public source.");
assert.equal(snapshot.reservations.length, 0);
assert.equal(snapshot.waitlist.length, 0);
assert.ok(snapshot.lessons.every((l: Record<string, unknown>) => l.pricePublished === false && l.instructorPhoto === undefined));
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), target: target.origin, commit: ready.commit, source: source.sourceUrl, capturedAt: source.capturedAt, range, count: expected.length, fieldsCompared: fields, unpublishedPricesHidden: true, fabricatedInstructorPhotos: false }, null, 2));

}

main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed."); process.exitCode = 1; });
