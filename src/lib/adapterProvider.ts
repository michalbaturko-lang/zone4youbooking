import type { LuxartAdapter } from "./domain";
import { mockLuxartAdapter } from "./mockLuxart";
import { createRealLuxartAdapter } from "./realLuxartAdapter";
import { readBookingSession } from "./session";
import type { Locale } from "./i18n";

export interface LuxartAdapterContext {
  userId?: string;
  locale?: Locale;
}

export function isRealLuxartMode() {
  return process.env.LUXART_MOCK === "false";
}

export function getLuxartAdapter(context: LuxartAdapterContext = {}): LuxartAdapter {
  const mockSetting = process.env.LUXART_MOCK;
  const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV;
  const isProduction = appEnvironment === "production" || process.env.VERCEL_ENV === "production";

  if (mockSetting === "false") {
    return createRealLuxartAdapter(context);
  }

  if (isProduction) {
    throw new Error("Production launch requires LUXART_MOCK=false.");
  }

  return mockLuxartAdapter;
}

export function getRequestLuxartAdapter(request: Request): LuxartAdapter {
  if (!isRealLuxartMode()) return getLuxartAdapter();
  const session = readBookingSession(request);
  const locale = request.headers.get("x-zone4you-locale") === "en" ? "en" : "cs";
  return getLuxartAdapter({ userId: session?.userId, locale });
}
