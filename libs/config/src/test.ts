import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Centralised test/E2E configuration.
 * Replaces EnvHandler in flows.ts and inline parsers in playwright configs.
 *
 * GOOGLE_TOKEN_URL is NOT included in apiServerEnv() defaults — always pass it explicitly.
 * Both playwright configs (dev_bypass and oauth) pass TestEnv.mockTokenUrl so that
 * browser-navigated callback tests work with code=e2e-auth-code. auth.setup.ts Path A
 * (real refresh token) calls the Google token endpoint directly from the test runner, so
 * it is unaffected by the API-side GOOGLE_TOKEN_URL override.
 */
export const e2eEnvSchema = z.object({
  HOST: z.string().default("localhost"),
  MOCK_OAUTH_PORT: z.coerce.number().default(4445),
  API_PORT: z.coerce.number().default(4000),
  WEB_PORT: z.coerce.number().default(3333),
  SESSION_COOKIE_NAME: z.string().default("g_auth_session"),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_TOKEN_URL: z.string().optional(),
});

let _e2eCache: z.infer<typeof e2eEnvSchema> | undefined;
function e2eParsed(): z.infer<typeof e2eEnvSchema> {
  if (!_e2eCache) _e2eCache = e2eEnvSchema.parse(process.env);
  return _e2eCache;
}

export const TestEnv = {
  get host(): string {
    return e2eParsed().HOST;
  },

  ports: {
    get web(): number {
      return e2eParsed().WEB_PORT;
    },
    get api(): number {
      return e2eParsed().API_PORT;
    },
    get mockOAuth(): number {
      return e2eParsed().MOCK_OAUTH_PORT;
    },
  },

  oauth: {
    clientId: "e2e-test-client-id",
    clientSecret: "e2e-test-client-secret",
    sessionSecret: "e2e-session-secret-that-is-at-least-32-chars!!!",
  },

  /**
   * KZO-198 — deterministic AES-256-GCM key fixture for E2E suites that
   * exercise the Tier 0 rotation flow. 64 lowercase hex chars (32 bytes).
   * NOT a production secret — never reuse outside test harness.
   */
  appConfigEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",

  get sessionCookieName(): string {
    return e2eParsed().SESSION_COOKIE_NAME;
  },

  get mockTokenUrl(): string {
    return `http://${TestEnv.host}:${TestEnv.ports.mockOAuth}/token`;
  },

  get googleRedirectUri(): string {
    return `http://${TestEnv.host}:${TestEnv.ports.api}/auth/google/callback`;
  },

  get appBaseUrl(): string {
    return `http://${TestEnv.host}:${TestEnv.ports.web}`;
  },

  get apiBaseUrl(): string {
    return `http://${TestEnv.host}:${TestEnv.ports.api}`;
  },

  get webBaseUrl(): string {
    return `http://${TestEnv.host}:${TestEnv.ports.web}`;
  },

  /**
   * Build env block for API webServer.
   * Returns standard mock credentials + port defaults.
   * Does NOT include GOOGLE_TOKEN_URL — pass it as an explicit override (e.g. TestEnv.mockTokenUrl).
   * Does NOT include AUTH_MODE — always pass it explicitly as an override.
   */
  apiServerEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      // KZO-198: NODE_ENV=test exempts the API server from the
      // `APP_CONFIG_ENCRYPTION_KEY` mandatory check in `validateEnvConstraints`.
      // E2E suites that exercise the Tier 0 rotation path (admin-settings-tier-a)
      // still need a valid 64-hex key so encryptSecret() can succeed at the
      // persistence boundary; we ship a deterministic fixture key.
      NODE_ENV: "test",
      APP_CONFIG_ENCRYPTION_KEY: TestEnv.appConfigEncryptionKey,
      API_PORT: String(TestEnv.ports.api),
      WEB_PORT: String(TestEnv.ports.web),
      PERSISTENCE_BACKEND: "memory",
      GOOGLE_CLIENT_ID: TestEnv.oauth.clientId,
      GOOGLE_CLIENT_SECRET: TestEnv.oauth.clientSecret,
      GOOGLE_REDIRECT_URI: TestEnv.googleRedirectUri,
      SESSION_SECRET: TestEnv.oauth.sessionSecret,
      APP_BASE_URL: TestEnv.appBaseUrl,
      ...overrides,
    };
  },

  /**
   * Build env block for web (Next.js) webServer.
   * Returns port defaults and NEXT_PUBLIC_API_BASE_URL.
   * Does NOT include NEXT_PUBLIC_AUTH_MODE — pass it as an override.
   */
  webServerEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      API_PORT: String(TestEnv.ports.api),
      WEB_PORT: String(TestEnv.ports.web),
      NEXT_PUBLIC_API_BASE_URL: TestEnv.apiBaseUrl,
      ...overrides,
    };
  },

  /**
   * Portable .env loader using the robust parser (P7).
   * Strips inline comments and surrounding quotes — matches libs/config/src/env.ts behaviour.
   * Only sets vars not already in process.env (preserves vitest test.env overrides).
   */
  loadDotEnvSync(repoRoot: string): void {
    const dotEnvPath = path.resolve(repoRoot, ".env.local");
    if (!fs.existsSync(dotEnvPath)) return;

    const raw = fs.readFileSync(dotEnvPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip inline comment (" # comment") — simple regex would miss this (P7)
      const commentStart = value.indexOf(" #");
      if (commentStart !== -1) value = value.slice(0, commentStart).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  },
};
