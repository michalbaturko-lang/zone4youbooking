import {
  getMockLuxartState,
  resetMockLuxartState,
  setMockLuxartState,
  type MockLuxartState,
} from "./mockLuxart";

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
  if (hasDemoState(body) && body.demoState) {
    setMockLuxartState(body.demoState);
    return;
  }
  resetMockLuxartState();
}

export async function readJsonWithDemoState<T>(request: Request): Promise<T> {
  const body = (await request.json().catch(() => ({}))) as T;
  restoreDemoState(body);
  return body;
}

export function withDemoState<T extends object>(data: T): T & { demoState?: MockLuxartState } {
  if (!isMockMode()) return data;
  return { ...data, demoState: getMockLuxartState() };
}
