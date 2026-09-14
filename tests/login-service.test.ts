import assert from "node:assert/strict";
import test from "node:test";
import type { LoginInput } from "../src/lib/domain";
import { BookingApiError } from "../src/lib/errors";
import { runLoginAttempt } from "../src/lib/loginService";

const loginInput: LoginInput = {
  login: "member@example.test",
  password: "private-password",
};

function request() {
  return new Request("https://booking.zone4you.cz/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(loginInput),
  });
}

function dependencies(
  calls: string[],
  limit: (scope: string) => void = () => undefined,
) {
  return {
    assertLiveReady: () => calls.push("live-ready"),
    limit: async (_request: Request, rule: { scope: string }, discriminator?: string) => {
      calls.push(`${rule.scope}:${discriminator ?? ""}`);
      limit(rule.scope);
    },
    readInput: async (current: Request) => {
      calls.push("read-input");
      return current.json();
    },
    parseInput: (value: unknown) => {
      calls.push("parse-input");
      return value as LoginInput;
    },
    login: async (input: LoginInput) => {
      calls.push("luxart-login");
      assert.deepEqual(input, loginInput);
      return {
        user: {
          id: "42",
          login: "member@example.test",
          fullName: "Test Member",
          email: "member@example.test",
          creditBalanceKc: 500,
        },
      };
    },
  };
}

test("live login passes readiness and both independent limits before Luxart", async () => {
  const calls: string[] = [];
  const result = await runLoginAttempt(request(), true, dependencies(calls));

  assert.equal(result.user.id, "42");
  assert.deepEqual(calls, [
    "live-ready",
    "auth-login-address:",
    "read-input",
    "parse-input",
    "auth-login-account:member@example.test",
    "luxart-login",
  ]);
});

test("a rejected live address bucket stops before reading credentials", async () => {
  const calls: string[] = [];
  const current = request();

  await assert.rejects(
    runLoginAttempt(current, true, dependencies(calls, (scope) => {
      if (scope === "auth-login-address") {
        throw new BookingApiError(429, "RATE_LIMITED", "Too many attempts.");
      }
    })),
    (error: unknown) => error instanceof BookingApiError && error.code === "RATE_LIMITED",
  );
  assert.deepEqual(calls, ["live-ready", "auth-login-address:"]);
  assert.equal(current.bodyUsed, false);
});

test("a rejected live account bucket stops before the Luxart request", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runLoginAttempt(request(), true, dependencies(calls, (scope) => {
      if (scope === "auth-login-account") {
        throw new BookingApiError(429, "RATE_LIMITED", "Too many attempts.");
      }
    })),
    (error: unknown) => error instanceof BookingApiError && error.code === "RATE_LIMITED",
  );
  assert.deepEqual(calls, [
    "live-ready",
    "auth-login-address:",
    "read-input",
    "parse-input",
    "auth-login-account:member@example.test",
  ]);
});

test("demo login retains its isolated address-and-account limiter", async () => {
  const calls: string[] = [];
  await runLoginAttempt(request(), false, dependencies(calls));

  assert.deepEqual(calls, [
    "read-input",
    "parse-input",
    "auth-login-demo:member@example.test",
    "luxart-login",
  ]);
});
