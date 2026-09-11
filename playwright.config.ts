import { defineConfig } from "@playwright/test";

const port = 3011;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  // One retry distinguishes an isolated browser/runtime stall from a deterministic regression.
  retries: 1,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    // The macOS headless SwiftShader process intermittently stalls during
    // actionability checks/context teardown; CPU rendering is deterministic
    // for these layout, flow and accessibility assertions.
    launchOptions: { args: ["--disable-gpu"] },
    screenshot: "only-on-failure",
    // Recording a full trace for every successful test adds renderer/screencast
    // pressure. Capture it on the isolated retry, where it is actionable.
    trace: "on-first-retry",
  },
  projects: [
    // The matrix intentionally starts with the smallest supported phone.
    {
      name: "mobile-small-320x568",
      use: {
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-standard-390x844",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-tablet-768x1024",
      use: {
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "landscape-phone-844x390",
      use: {
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop-1440x900",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      LUXART_MOCK: "true",
      NEXT_PUBLIC_APP_ENV: "demo",
      APP_BASE_URL: baseURL,
    },
  },
});
