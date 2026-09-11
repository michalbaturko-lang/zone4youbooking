import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLuxartResourceMapping,
  parseLuxartTextMapping,
  validLuxartResourceMapping,
  validLuxartTextMapping,
} from "../src/lib/luxartMappings";

test("normalizes bounded Luxart room and lesson-type display mappings", () => {
  assert.deepEqual(
    parseLuxartTextMapping(JSON.stringify({ 0: " Neuvedeno ", 2: " Cycling sál " }), "ROOM_MAP"),
    { 0: "Neuvedeno", 2: "Cycling sál" },
  );
  assert.equal(parseLuxartTextMapping(undefined, "ROOM_MAP"), undefined);
  assert.equal(validLuxartTextMapping(JSON.stringify({ 8: "Cardio" })), true);
});

test("rejects display mappings that could corrupt or crash the schedule UI", () => {
  for (const mapping of [
    "[]",
    JSON.stringify({ room: "Cycling" }),
    JSON.stringify({ "02": "Cycling" }),
    JSON.stringify({ 2: 42 }),
    JSON.stringify({ 2: "" }),
    JSON.stringify({ 2: "Bad\nlabel" }),
    JSON.stringify({ 2: "x".repeat(121) }),
  ]) {
    assert.equal(validLuxartTextMapping(mapping), false);
  }
});

test("accepts only complete positive room-to-resource mappings", () => {
  assert.deepEqual(
    parseLuxartResourceMapping(JSON.stringify({ 1: 101, 2: "207" })),
    { 1: 101, 2: 207 },
  );
  for (const mapping of [
    undefined,
    "{}",
    "[]",
    JSON.stringify({ 0: 101 }),
    JSON.stringify({ "02": 207 }),
    JSON.stringify({ 2: 0 }),
    JSON.stringify({ 2: "not-a-number" }),
  ]) {
    assert.equal(validLuxartResourceMapping(mapping), false);
  }
});
