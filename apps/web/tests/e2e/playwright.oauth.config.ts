import path from "path";
import { fileURLToPath } from "url";
import { devices } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { createPlaywrightConfig } from "@vakwen/test-framework/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// Phase 3g (§12 A8) — mobile + tablet viewport gates for the OAuth suite.
//
// The default `oauth` project runs every spec EXCEPT `mobile-*-aaa.spec.ts`.
// The two viewport variants run ONLY `mobile-*-aaa.spec.ts` at their pinned
// viewports. No mobile OAuth specs ship in Phase 3g — the projects exist
// here so future OAuth-gated mobile specs (e.g. mobile-shared-account-aaa)
// can land without reworking the config.
export default createPlaywrightConfig({
  testDir: "./specs-oauth",
  repoRoot,
  webServers: "full",
  authMode: "oauth",
  timeout: 60_000,
  expectTimeout: 15_000,
  workers: 1,
  reportFolder: "playwright-report-oauth",
  videoMode: "retain-on-failure",
  projects: [
    {
      name: "oauth",
      testDir: "./specs-oauth",
      testIgnore: /mobile-.*-aaa\.spec\.ts/,
    },
    {
      name: "chromium-mobile",
      testDir: "./specs-oauth",
      use: { ...devices["iPhone SE"], browserName: "chromium", viewport: { width: 375, height: 667 } },
      testMatch: /mobile-.*-aaa\.spec\.ts/,
    },
    {
      name: "chromium-tablet",
      testDir: "./specs-oauth",
      use: { ...devices["iPad Mini"], browserName: "chromium", viewport: { width: 768, height: 1024 } },
      testMatch: /mobile-.*-aaa\.spec\.ts/,
    },
  ],
  apiEnvOverrides: {
    DEMO_MODE_ENABLED: "true",
    PERSISTENCE_BACKEND: process.env.PERSISTENCE_BACKEND ?? "memory",
    GOOGLE_CLIENT_ID: TestEnv.oauth.clientId,
    GOOGLE_CLIENT_SECRET: TestEnv.oauth.clientSecret,
    GOOGLE_REDIRECT_URI: TestEnv.googleRedirectUri,
    SESSION_SECRET: TestEnv.oauth.sessionSecret,
    APP_BASE_URL: TestEnv.appBaseUrl,
  },
  webEnvOverrides: {
    DEMO_MODE_ENABLED: "true",
    SESSION_SECRET: TestEnv.oauth.sessionSecret,
  },
});
