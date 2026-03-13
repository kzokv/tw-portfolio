import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to repo root from apps/web/tests/e2e/; update if E2E layout changes
const repoRoot = path.resolve(__dirname, "../../../..");

const webPort = Number(process.env.WEB_PORT ?? 3333);
const apiPort = Number(process.env.API_PORT ?? 4000);

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  timeout: 45_000,
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
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: {
      mode: "retain-on-failure",
    },
  },
  webServer: [
    {
      command: "npm run build -w libs/domain -w libs/shared-types && npm run dev -w apps/api",
      url: `http://127.0.0.1:${apiPort}/health/live`,
      timeout: 60_000,
      cwd: repoRoot,
      reuseExistingServer: true,
      stderr: "pipe",
      stdout: "ignore",
      gracefulShutdown: {
        signal: "SIGINT",
        timeout: 10_000,
      },
      env: {
        API_PORT: String(apiPort),
        WEB_PORT: String(webPort),
        AUTH_MODE: "dev_bypass",
        NODE_ENV: "development",
        PERSISTENCE_BACKEND: "memory",
      },
    },
    {
      command: "npm run build -w libs/shared-types -w @tw-portfolio/web && npm run start -w apps/web",
      cwd: repoRoot,
      url: `http://127.0.0.1:${webPort}`,
      timeout: 120_000,
      reuseExistingServer: true,
      stderr: "pipe",
      stdout: "ignore",
      gracefulShutdown: {
        signal: "SIGINT",
        timeout: 10_000,
      },
      env: {
        API_PORT: String(apiPort),
        WEB_PORT: String(webPort),
        NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
