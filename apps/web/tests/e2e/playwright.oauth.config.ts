import path from "path";
import { fileURLToPath } from "url";
import { TestEnv } from "@tw-portfolio/config/test";
import { createPlaywrightConfig } from "@tw-portfolio/test-framework/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export default createPlaywrightConfig({
  testDir: "./specs-oauth",
  repoRoot,
  webServers: "full",
  authMode: "oauth",
  timeout: 60_000,
  expectTimeout: 15_000,
  workers: 2,
  reportFolder: "playwright-report-oauth",
  videoMode: "retain-on-failure",
  projects: [{ name: "oauth", testDir: "./specs-oauth" }],
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
