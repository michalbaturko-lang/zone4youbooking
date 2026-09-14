import {
  getMockLuxartState,
  resetMockLuxartState,
  setMockLuxartState,
  type MockLuxartState,
} from "./mockLuxart";
import { readBoundedJson } from "./requestBody";
import { isSafeMockLuxartState, safeSerializedDemoState } from "./demoState";

type BodyWithDemoState = {
  demoState?: MockLuxartState;
};

function isMockMode() {
  return process.env.LUXART_MOCK !== "false";
}

function hasDemoState(body: unknown): body is BodyWithDemoState {
  return typeof body === "object" && body !== null && "demoState" in body;
}

export function restoreDemoState(body: unknown) {
  if (!isMockMode()) return;
  if (
    hasDemoState(body) &&
    isSafeMockLuxartState(body.demoState) &&
    safeSerializedDemoState(body.demoState)
  ) {
    setMockLuxartState(body.demoState);
    return;
  }
  resetMockLuxartState();
}

export async function readJsonWithDemoState<T>(request: Request): Promise<T> {
  const body = await readBoundedJson<T>(request);
  restoreDemoState(body);
  return body;
}

export function withDemoState<T extends object>(data: T): T & { demoState?: MockLuxartState } {
  if (!isMockMode()) return data;
  return { ...data, demoState: getMockLuxartState() };
}
