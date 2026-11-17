import type { LuxartAdapter } from "./domain";
import { mockLuxartAdapter } from "./mockLuxart";
import { createRealLuxartAdapter } from "./realLuxartAdapter";
import { readBookingSession } from "./session";
import type { Locale } from "./i18n";
import { assertLivePersonalizedAccessReady } from "./liveAccessGate";

export interface LuxartAdapterContext {
  userId?: string;
  locale?: Locale;
}

export function isRealLuxartMode() {
  return process.env.LUXART_MOCK === "false";
}

// Hosting production and launching the live club system are distinct choices.
// An explicit demo on production hosting must still use only mock data.
export function mockLuxartConfigurationReady(environment = process.env) {
  if (environment.NEXT_PUBLIC_APP_ENV === "production") return false;
  return environment.VERCEL_ENV !== "production" || (
    environment.LUXART_MOCK === "true" && environment.NEXT_PUBLIC_APP_ENV === "demo"
  );
}

export function getLuxartAdapter(context: LuxartAdapterContext = {}): LuxartAdapter {
  const mockSetting = process.env.LUXART_MOCK;

  if (mockSetting === "false") {
    return createRealLuxartAdapter(context);
  }

  if (!mockLuxartConfigurationReady()) {
    throw new Error("Live production requires LUXART_MOCK=false; a hosted demo requires explicit LUXART_MOCK=true and NEXT_PUBLIC_APP_ENV=demo.");
  }

  return mockLuxartAdapter;
}

export function getRequestLuxartAdapter(request: Request): LuxartAdapter {
  if (!isRealLuxartMode()) return getLuxartAdapter();
  const session = readBookingSession(request);
  if (session) assertLivePersonalizedAccessReady();
  const locale = request.headers.get("x-zone4you-locale") === "en" ? "en" : "cs";
  return getLuxartAdapter({ userId: session?.userId, locale });
}
