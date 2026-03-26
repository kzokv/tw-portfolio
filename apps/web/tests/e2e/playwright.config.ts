import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { TestEnv } from "@tw-portfolio/config/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to repo root from apps/web/tests/e2e/; update if E2E layout changes
const repoRoot = path.resolve(__dirname, "../../../..");

const webPort = TestEnv.ports.web;
const apiPort = TestEnv.ports.api;
const mockOAuthPort = TestEnv.ports.mockOAuth;

const host = TestEnv.host;

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "on-failure", outputFolder: path.join(repoRoot, "apps/web/playwright-report") }],
  ],
  use: {
    baseURL: `http://${host}:${webPort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: {
      mode: "retain-on-failure",
    },
  },
  webServer: [
    {
      command: "bash ../../scripts/reclaim-e2e-server.sh mock-oauth && node tests/e2e/helpers/mock-oauth-server.mjs",
      port: mockOAuthPort,
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
        AUTH_MODE: "dev_bypass",
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
        NEXT_PUBLIC_AUTH_MODE: "dev_bypass",
      }),
    },
  ],
});
