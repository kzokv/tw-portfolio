import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlaywrightConfig } from "@vakwen/test-framework/config";
import { TestEnv } from "@vakwen/config/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export default createPlaywrightConfig({
  testDir: "./specs",
  repoRoot,
  webServers: "api-only",
  authMode: "oauth",
  reportFolder: "playwright-report-http",
  // Serialize cross-file execution. The per-IP anon-share rate-limit bucket
  // (30 req / 5 min) is shared across specs; any parallel spec that hits
  // /share/:token pollutes the bucket and breaks the rate-limit test.
  workers: 1,
  apiEnvOverrides: {
    DEMO_MODE_ENABLED: "true",
    PERSISTENCE_BACKEND: "memory",
    GOOGLE_CLIENT_ID: TestEnv.oauth.clientId,
    GOOGLE_CLIENT_SECRET: TestEnv.oauth.clientSecret,
    GOOGLE_REDIRECT_URI: TestEnv.googleRedirectUri,
    SESSION_SECRET: TestEnv.oauth.sessionSecret,
    APP_BASE_URL: TestEnv.appBaseUrl,
    // Keep HTTP tests deterministic: AU search/catalog specs assert against
    // fixture rows and must not depend on live Yahoo/Twelve Data response shape.
    AU_PROVIDER_MOCK: "true",
    AU_CATALOG_PROVIDER_MOCK: "true",
    KR_PROVIDER_MOCK: "true",
    KR_CATALOG_PROVIDER_MOCK: "true",
    // HTTP tests run many mutations per minute from one IP + "anonymous" user
    // (e.g. POST /__e2e/oauth-session for every testUser fixture). The default
    // 120/min cap trips under the full suite; bump for tests only.
    RATE_LIMIT_MAX_MUTATIONS: "5000",
  },
});
