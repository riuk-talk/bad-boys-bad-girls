import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 3100);
// The pre-installed Chromium of the Claude Code environment; elsewhere (CI), Playwright's own.
const LOCAL_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);
// The full Chromium (new headless mode), not the headless shell: the shell has neither
// Notification nor PushManager, which the Web Push prompt and service worker tests need.
const chromium = executablePath
  ? { launchOptions: { executablePath } }
  : { channel: "chromium" as const };

// Critical journeys, run on the two phone profiles (CI: local Supabase stack, see
// scripts/ci/local-env.mjs): sign-up, onboarding, Demande de parloir and Courrier, the push route.
const CRITICAL =
  /(signup|password-recovery|onboarding-complete|relations|push-route|email-route|moderation-rgpd|web-vitals|photo-cutout|super-admin|admin-roles|admin-member-record|messagerie|journey|realtime-channels|captcha)\.spec\.ts$/;
// Only in CI or on demand: WebKit is not installed everywhere.
const DEVICES = process.env.CI === "true" || process.env.E2E_DEVICES === "true";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    {
      name: "mobile-360",
      use: { ...devices["Desktop Chrome"], ...chromium, viewport: { width: 360, height: 780 } },
    },
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], ...chromium, viewport: { width: 1440, height: 900 } },
    },
    ...(DEVICES
      ? [
          // Android: Chromium with the Pixel 7 screen, touch and user agent.
          { name: "pixel-7", testMatch: CRITICAL, use: { ...devices["Pixel 7"], ...chromium } },
          // iPhone: WebKit (Safari's engine) on Linux with the iPhone 14 screen, not iOS Safari.
          { name: "iphone-14", testMatch: CRITICAL, use: { ...devices["iPhone 14"] } },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
