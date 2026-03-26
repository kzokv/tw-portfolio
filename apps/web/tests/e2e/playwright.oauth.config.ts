import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { TestEnv } from "@tw-portfolio/config/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const webPort = TestEnv.ports.web;
const apiPort = TestEnv.ports.api;

// The session cookie (SESSION_COOKIE_NAME, default: __Host-g_auth_session) is set by the API on the hostname used in GOOGLE_REDIRECT_URI.
// NEXT_PUBLIC_API_BASE_URL and APP_BASE_URL must use that same hostname so the browser
// includes the cookie when the web app calls the API (cookies don't cross hostnames).
const host = TestEnv.host;

export default defineConfig({
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 2,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "on-failure",
        outputFolder: path.join(repoRoot, "apps/web/playwright-report-oauth"),
      },
    ],
  ],
  use: {
    baseURL: `http://${host}:${webPort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: {
      mode: "on",
    },
  },
  projects: [
    {
      name: "oauth",
      testDir: "./specs-oauth",
    },
  ],
  webServer: [
    {
      command: "bash ../../scripts/reclaim-e2e-server.sh mock-oauth && node tests/e2e/helpers/mock-oauth-server.mjs",
      port: TestEnv.ports.mockOAuth,
      cwd: path.resolve(repoRoot, "apps/web"),
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "bash scripts/reclaim-e2e-server.sh api && npm run build -w @tw-portfolio/config -w libs/domain -w libs/shared-types && npm run dev -w apps/api",
      url: `http://${host}:${apiPort}/health/live`,
      timeout: 60_000,
      cwd: repoRoot,
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "ignore",
      gracefulShutdown: {
        signal: "SIGINT",
        timeout: 10_000,
      },
      env: TestEnv.apiServerEnv({
        AUTH_MODE: "oauth",
        DEMO_MODE_ENABLED: "true",
        PERSISTENCE_BACKEND: process.env.PERSISTENCE_BACKEND ?? "memory",
        GOOGLE_CLIENT_ID: TestEnv.oauth.clientId,
        GOOGLE_CLIENT_SECRET: TestEnv.oauth.clientSecret,
        GOOGLE_REDIRECT_URI: TestEnv.googleRedirectUri,
        SESSION_SECRET: TestEnv.oauth.sessionSecret,
        APP_BASE_URL: TestEnv.appBaseUrl,
        // Route code-exchange through the mock OAuth server so callback tests work with
        // code=e2e-auth-code. auth.setup.ts Path A (real refresh token) is unaffected — it
        // calls the Google token endpoint directly from the test runner, not via this env var.
        GOOGLE_TOKEN_URL: TestEnv.mockTokenUrl,
      }),
    },
    {
      command: "bash scripts/reclaim-e2e-server.sh web && npm run dev -w @tw-portfolio/web",
      cwd: repoRoot,
      url: `http://${host}:${webPort}`,
      timeout: 60_000,
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "ignore",
      gracefulShutdown: {
        signal: "SIGINT",
        timeout: 10_000,
      },
      env: TestEnv.webServerEnv({
        NEXT_PUBLIC_AUTH_MODE: "oauth",
        DEMO_MODE_ENABLED: "true",
        SESSION_SECRET: TestEnv.oauth.sessionSecret,
      }),
    },
  ],
});
