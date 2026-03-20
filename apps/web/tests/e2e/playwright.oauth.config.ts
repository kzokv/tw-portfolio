import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { TestEnv } from "@tw-portfolio/config/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// Load repo-root .env.local for local runs where vars aren't pre-exported to the shell.
// Uses the robust parser (P7: strips inline comments and surrounding quotes).
TestEnv.loadDotEnvSync(repoRoot);

const webPort = TestEnv.ports.web;
const apiPort = TestEnv.ports.api;
const authFile = path.join(__dirname, ".auth/oauth-session.json");

// The session cookie (SESSION_COOKIE_NAME, default: __Host-g_auth_session) is set by the API on the hostname used in GOOGLE_REDIRECT_URI.
// NEXT_PUBLIC_API_BASE_URL and APP_BASE_URL must use that same hostname so the browser
// includes the cookie when the web app calls the API (cookies don't cross hostnames).
const host = TestEnv.host;

export default defineConfig({
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
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
      name: "setup",
      testDir: "./setup",
      testMatch: /.*\.setup\.ts/,
      // No browser needed — setup uses Playwright's request API context only.
    },
    {
      name: "oauth",
      testDir: "./specs-oauth",
      use: {
        storageState: authFile,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "npm run build -w @tw-portfolio/config -w libs/domain -w libs/shared-types && npm run dev -w apps/api",
      url: `http://${host}:${apiPort}/health/live`,
      timeout: 60_000,
      cwd: repoRoot,
      reuseExistingServer: true,
      stderr: "pipe",
      stdout: "ignore",
      gracefulShutdown: {
        signal: "SIGINT",
        timeout: 10_000,
      },
      env: TestEnv.apiServerEnv({
        AUTH_MODE: "oauth",
        PERSISTENCE_BACKEND: process.env.PERSISTENCE_BACKEND ?? "memory",
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? TestEnv.oauth.clientId,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? TestEnv.oauth.clientSecret,
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ?? TestEnv.googleRedirectUri,
        SESSION_SECRET: process.env.SESSION_SECRET ?? TestEnv.oauth.sessionSecret,
        APP_BASE_URL: process.env.APP_BASE_URL ?? TestEnv.appBaseUrl,
        // Route code-exchange through the mock OAuth server so callback tests work with
        // code=e2e-auth-code. The mock server is started by playwright.config.ts (dev_bypass
        // suite); when both suites run together the mock is already on TestEnv.ports.mockOAuth.
        // auth.setup.ts Path A (real refresh token) is unaffected — it calls the Google token
        // endpoint directly from the test runner, not via the API's GOOGLE_TOKEN_URL env var.
        GOOGLE_TOKEN_URL: TestEnv.mockTokenUrl,
      }),
    },
    {
      command: "npm run dev -w @tw-portfolio/web",
      cwd: repoRoot,
      url: `http://${host}:${webPort}`,
      timeout: 60_000,
      reuseExistingServer: true,
      stderr: "pipe",
      stdout: "ignore",
      gracefulShutdown: {
        signal: "SIGINT",
        timeout: 10_000,
      },
      env: TestEnv.webServerEnv({
        NEXT_PUBLIC_AUTH_MODE: "oauth",
      }),
    },
  ],
});
