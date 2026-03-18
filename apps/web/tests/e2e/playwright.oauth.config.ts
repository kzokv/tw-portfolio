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
      use: {
        headless: false,
        // Real Chrome avoids Google's bot-detection (Playwright's Chromium triggers "Couldn't sign you in").
        // --disable-blink-features=AutomationControlled removes the navigator.webdriver flag.
        channel: "chrome",
        launchOptions: {
          args: ["--disable-blink-features=AutomationControlled"],
        },
      },
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
      // CRITICAL (P3): No GOOGLE_TOKEN_URL here — real OAuth must use Google's actual token endpoint.
      env: TestEnv.apiServerEnv({
        AUTH_MODE: "oauth",
        PERSISTENCE_BACKEND: process.env.PERSISTENCE_BACKEND ?? "memory",
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ?? TestEnv.googleRedirectUri,
        SESSION_SECRET: process.env.SESSION_SECRET ?? "",
        APP_BASE_URL: process.env.APP_BASE_URL ?? TestEnv.appBaseUrl,
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
