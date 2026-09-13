import type { LoginInput, LoginResult } from "./domain";
import { getLuxartAdapter } from "./adapterProvider";
import { readJsonWithDemoState } from "./demoStateTransport";
import { assertLivePersonalizedAccessReady } from "./liveAccessGate";
import { parseLoginInput } from "./loginInput";
import { assertRateLimit, rateLimitRules, type RateLimitRule } from "./rateLimit";

interface LoginAttemptDependencies {
  assertLiveReady: () => void;
  limit: (request: Request, rule: RateLimitRule, discriminator?: string) => Promise<unknown>;
  readInput: (request: Request) => Promise<unknown>;
  parseInput: (value: unknown) => LoginInput;
  login: (input: LoginInput) => Promise<LoginResult>;
}

const defaultDependencies: LoginAttemptDependencies = {
  assertLiveReady: assertLivePersonalizedAccessReady,
  limit: assertRateLimit,
  readInput: (request) => readJsonWithDemoState<LoginInput>(request),
  parseInput: parseLoginInput,
  login: (input) => getLuxartAdapter().login(input),
};

export async function runLoginAttempt(
  request: Request,
  live: boolean,
  dependencies: LoginAttemptDependencies = defaultDependencies,
) {
  if (live) {
    dependencies.assertLiveReady();
    await dependencies.limit(request, rateLimitRules.loginAddress);
  }

  const rawInput = await dependencies.readInput(request);
  const input = dependencies.parseInput(rawInput);
  await dependencies.limit(
    request,
    live ? rateLimitRules.loginAccount : rateLimitRules.loginDemo,
    input.login,
  );
  return dependencies.login(input);
}
