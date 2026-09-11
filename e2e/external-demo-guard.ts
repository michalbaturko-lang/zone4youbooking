import type { FullConfig } from "@playwright/test";

type Environment = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface DemoReadiness {
  status?: unknown;
  mode?: unknown;
  phase?: unknown;
  luxart?: unknown;
  schedule?: unknown;
  capabilities?: {
    reservationsEnabled?: unknown;
    topupMode?: unknown;
    forgotPasswordEnabled?: unknown;
    englishEnabled?: unknown;
  };
}

export function externalDemoOrigin(environment: Environment = process.env) {
  const raw = environment.PLAYWRIGHT_EXTERNAL_DEMO_URL?.trim();
  if (!raw) return undefined;

  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PLAYWRIGHT_EXTERNAL_DEMO_URL must be a clean root HTTPS URL.");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "booking.zone4you.cz" ||
    host === "zone4youbooking.vercel.app" ||
    !/^zone4youbooking-[a-z0-9-]+-mbos-projects-220653ae\.vercel\.app$/.test(host)
  ) {
    throw new Error("External browser regression is restricted to an isolated Zone4You Vercel Preview deployment.");
  }
  return url.origin;
}

export function externalDemoRequestHeaders(environment: Environment = process.env): Record<string, string> {
  return externalDemoOrigin(environment)
    ? { "x-vercel-skip-toolbar": "1" }
    : {};
}

export function isExpectedExternalDemoConsoleNoise(
  message: string,
  environment: Environment = process.env,
) {
  if (!externalDemoOrigin(environment)) return false;
  return message.includes("https://vercel.live/_next-live/feedback/feedback.js") &&
    message.includes("violates the following Content Security Policy directive") &&
    message.endsWith("The action has been blocked.");
}

export function assertExternalDemoReadiness(payload: DemoReadiness) {
  const safeDemo = payload.status === "ready" &&
    payload.mode === "demo" &&
    payload.phase === "demo" &&
    payload.luxart === "mock" &&
    payload.schedule === "mock" &&
    payload.capabilities?.reservationsEnabled === true &&
    payload.capabilities?.topupMode === "demo" &&
    payload.capabilities?.forgotPasswordEnabled === false &&
    payload.capabilities?.englishEnabled === true;
  if (!safeDemo) {
    throw new Error("External browser regression refused: target did not prove the isolated demo/mock capability profile.");
  }
}

export async function verifyExternalDemoTarget(
  environment: Environment = process.env,
  fetchImpl: FetchLike = fetch,
) {
  const origin = externalDemoOrigin(environment);
  if (!origin) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`${origin}/api/readiness`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("External browser regression refused: readiness endpoint is not healthy.");
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > 16_384) {
      throw new Error("External browser regression refused: readiness response is unexpectedly large.");
    }
    const payload = await response.json() as DemoReadiness;
    assertExternalDemoReadiness(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function externalDemoGuard(_: FullConfig) {
  await verifyExternalDemoTarget();
}
