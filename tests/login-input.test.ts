import assert from "node:assert/strict";
import test from "node:test";
import { parseLoginInput } from "../src/lib/loginInput";
import { BookingApiError } from "../src/lib/errors";

test("login accepts surname, email or username and does not truncate a non-four-digit password", () => {
  assert.deepEqual(parseLoginInput({ login: " Nováková ", password: "2048" }), {
    login: "Nováková",
    password: "2048",
    memberCardNumber: undefined,
  });
  assert.deepEqual(parseLoginInput({ login: "client@example.invalid", password: "a-long-member-password" }), {
    login: "client@example.invalid",
    password: "a-long-member-password",
    memberCardNumber: undefined,
  });
});

test("login rejects missing and unbounded credentials with a stable privacy-safe error", () => {
  for (const input of [
    {},
    { login: "", password: "2048" },
    { login: "client", password: "" },
    { login: "x".repeat(255), password: "2048" },
    { login: "client", password: "x".repeat(129) },
  ]) {
    assert.throws(
      () => parseLoginInput(input),
      (error: unknown) =>
        error instanceof BookingApiError &&
        error.status === 400 &&
        error.code === "INVALID_LOGIN_INPUT" &&
        !error.message.includes("2048"),
    );
  }
});
