import assert from "node:assert/strict";
import test from "node:test";
import cs from "../src/messages/cs.json";
import en from "../src/messages/en.json";
import { translate } from "../src/lib/i18n";

function placeholders(message: string) {
  return [...message.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

test("Czech and English message catalogs contain the same keys and placeholders", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(cs).sort());
  for (const key of Object.keys(cs) as Array<keyof typeof cs>) {
    assert.deepEqual(placeholders(en[key]), placeholders(cs[key]), `Placeholder mismatch for ${key}`);
    assert.ok(en[key].trim(), `Missing English translation for ${key}`);
  }
});

test("translation interpolates values without exposing unresolved placeholders", () => {
  assert.equal(translate("en", "toast.reserved", { lesson: "PILATES" }), "Your PILATES booking is confirmed.");
  assert.equal(translate("cs", "status.free", { count: 4 }), "4 volných");
});
