import { defineConfig } from "@playwright/test";
import path from "node:path";
import { TestEnv } from "@tw-portfolio/config/test";

type TWebServerMode = "full" | "api-only";

interface TPlaywrightProject {
  name: string;
  testDir: string;
}

interface TCreatePlaywrightConfigOptions {
  webServers: TWebServerMode;
  testDir: string;
  repoRoot: string;
  authMode?: "dev_bypass" | "oauth";
  apiEnvOverrides?: Record<string, string>;
  webEnvOverrides?: Record<string, string>;
  workers?: number;
  timeout?: number;
  expectTimeout?: number;
  reportFolder?: string;
  projects?: TPlaywrightProject[];
  videoMode?: "off" | "on" | "retain-on-failure";
}

export function createPlaywrightConfig(options: TCreatePlaywrightConfigOptions) {
  const {
    webServers,
    testDir,
    repoRoot,
    authMode = "dev_bypass",
    apiEnvOverrides = {},
    webEnvOverrides = {},
    workers,
    timeout = 30_000,
    expectTimeout = 10_000,
    reportFolder = "playwright-report",
    projects,
    videoMode = "retain-on-failure",
  } = options;

  const host = TestEnv.host;
  const webPort = TestEnv.ports.web;
  const apiPort = TestEnv.ports.api;
  const useExistingServers = ["1", "true"].includes(
    process.env.PLAYWRIGHT_USE_EXISTING_SERVERS?.toLowerCase() ?? "",
  );

  const mockOAuthServer = {
    command: "bash ../../scripts/reclaim-e2e-server.sh mock-oauth && node ../../libs/test-e2e/src/mock-oauth-server.mjs",
    port: TestEnv.ports.mockOAuth,
    cwd: path.resolve(repoRoot, "apps/web"),
    reuseExistingServer: false,
    stdout: "ignore" as const,
    stderr: "pipe" as const,
  };

  const apiServer = {
    command: "bash scripts/reclaim-e2e-server.sh api && npm run build -w @tw-portfolio/config -w libs/domain -w libs/shared-types && npx tsx watch apps/api/src/server.ts",
    url: `http://${host}:${apiPort}/health/live`,
    timeout: 60_000,
    cwd: repoRoot,
    reuseExistingServer: false,
    stdout: "ignore" as const,
    stderr: "pipe" as const,
    gracefulShutdown: {
      signal: "SIGINT" as const,
      timeout: 10_000,
    },
    env: TestEnv.apiServerEnv({
      AUTH_MODE: authMode,
      GOOGLE_TOKEN_URL: TestEnv.mockTokenUrl,
      ...apiEnvOverrides,
    }),
  };

  const webServer = {
    command:
      "bash scripts/reclaim-e2e-server.sh web && cd apps/web && NODE_ENV=test PORT=${WEB_PORT:-3333} node .next/standalone/apps/web/server.js",
    cwd: repoRoot,
    url: `http://${host}:${webPort}`,
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: "ignore" as const,
    stderr: "pipe" as const,
    gracefulShutdown: {
      signal: "SIGINT" as const,
      timeout: 10_000,
    },
    env: TestEnv.webServerEnv({
      NEXT_PUBLIC_AUTH_MODE: authMode,
      SESSION_COOKIE_NAME: TestEnv.sessionCookieName,
      SESSION_SECRET: TestEnv.oauth.sessionSecret,
      ...webEnvOverrides,
    }),
  };

  const reportApp = webServers === "full" ? "apps/web" : "apps/api";

  return defineConfig({
    testDir,
    fullyParallel: false,
    timeout,
    expect: {
      timeout: expectTimeout,
    },
    retries: process.env.CI ? 2 : 0,
    ...(workers !== undefined ? { workers } : process.env.CI ? { workers: 2 } : {}),
    reporter: [
      ["list"],
      ["html", { open: "on-failure", outputFolder: path.join(repoRoot, reportApp, reportFolder) }],
    ],
    use: {
      baseURL: webServers === "full" ? `http://${host}:${webPort}` : `http://${host}:${apiPort}`,
      trace: "on-first-retry",
      screenshot: "only-on-failure",
      video: {
        mode: videoMode,
      },
    },
    ...(projects ? { projects } : {}),
    ...(useExistingServers
      ? {}
      : {
          webServer:
            webServers === "full" ? [mockOAuthServer, apiServer, webServer] : [mockOAuthServer, apiServer],
        }),
  });
}
