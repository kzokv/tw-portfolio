import fs from "node:fs";
import path from "node:path";

/**
 * Centralised test/E2E configuration.
 * Replaces EnvHandler in flows.ts and inline parsers in playwright configs.
 *
 * CRITICAL (P3): GOOGLE_TOKEN_URL is NEVER included in apiServerEnv() defaults.
 * Standard Playwright config passes it explicitly (mock server).
 * OAuth Playwright config omits it entirely (real Google endpoint).
 */
export const TestEnv = {
  get host(): string {
    return process.env.HOST ?? "localhost";
  },

  ports: {
    get web(): number {
      return Number(process.env.WEB_PORT ?? 3333);
    },
    get api(): number {
      return Number(process.env.API_PORT ?? 4000);
    },
    get mockOAuth(): number {
      return Number(process.env.MOCK_OAUTH_PORT ?? 4445);
    },
  },

  oauth: {
    clientId: "e2e-test-client-id",
    clientSecret: "e2e-test-client-secret",
    sessionSecret: "e2e-session-secret-that-is-at-least-32-chars!!!",
  },

  get sessionCookieName(): string {
    return process.env.SESSION_COOKIE_NAME ?? "__Host-g_auth_session";
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
   * Does NOT include GOOGLE_TOKEN_URL — pass it as an override when needed (standard config).
   * Does NOT include AUTH_MODE — always pass it explicitly as an override.
   */
  apiServerEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
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
