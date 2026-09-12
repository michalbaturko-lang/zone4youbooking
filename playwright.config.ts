import { defineConfig } from "@playwright/test";

const port = 3011;
const localBaseURL = `http://127.0.0.1:${port}`;
const externalDemoBaseURL = process.env.PLAYWRIGHT_EXTERNAL_DEMO_URL?.trim();
const baseURL = externalDemoBaseURL || localBaseURL;
const chromiumLaunchOptions = { args: ["--disable-gpu"] };

export default defineConfig({
  testDir: "./e2e",
  // A public Preview must stay a low-volume smoke check. The full local suite
  // intentionally exercises authentication repeatedly and would trip the
  // production-shaped login throttle after five attempts in ten minutes.
  grep: externalDemoBaseURL ? /@preview/ : undefined,
  outputDir: "test-results/playwright",
  fullyParallel: false,
  workers: 1,
  // One retry distinguishes an isolated browser/runtime stall from a deterministic regression.
  retries: 1,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  globalSetup: "./e2e/external-demo-guard.ts",
  use: {
    baseURL,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
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
        browserName: "chromium",
        // The macOS headless SwiftShader process intermittently stalls during
        // actionability checks/context teardown; CPU rendering is deterministic
        // for these layout, flow and accessibility assertions.
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-standard-390x844",
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-tablet-768x1024",
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "landscape-phone-844x390",
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop-1440x900",
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-webkit-390x844",
      // A second rendering engine covers the public mobile UI without
      // repeating login or booking mutations. Authenticated WebKit UAT stays
      // a deliberate staging step once the real Luxart endpoint is available.
      grep: /@preview(?!-auth)/,
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: externalDemoBaseURL ? undefined : {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${localBaseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      LUXART_MOCK: "true",
      NEXT_PUBLIC_APP_ENV: "demo",
      APP_BASE_URL: localBaseURL,
    },
  },
});
