import type { LuxartAdapter } from "./domain";
import { mockLuxartAdapter } from "./mockLuxart";
import { createRealLuxartAdapter } from "./realLuxartAdapter";

export function getLuxartAdapter(): LuxartAdapter {
  if (process.env.LUXART_MOCK === "false") {
    return createRealLuxartAdapter();
  }

  return mockLuxartAdapter;
}
