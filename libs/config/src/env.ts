import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EnvConfig } from "./env-schema.js";
import { envSchema, parseDotEnvLine } from "./env-schema.js";

export type { EnvConfig } from "./env-schema.js";
export { envSchema } from "./env-schema.js";

loadDotEnv();

const _parsed: EnvConfig = envSchema.parse(process.env);

/**
 * Structural twin of GoogleOAuthConfig in apps/api/src/auth/googleOAuth.ts.
 * Fields must remain identical — see P10 compile-time check in apps/api/src/app.ts.
 */
export interface GoogleOAuthEnvConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  /** Override the Google token endpoint URL (used in E2E tests to point at a mock server). */
  tokenUrl?: string;
}

export const Env = Object.freeze({
  ..._parsed,

  validateEnvConstraints(
    envInput: Pick<EnvConfig,
      "API_PORT" | "WEB_PORT" | "DB_PORT" | "REDIS_PORT" |
      "AUTH_MODE" | "NODE_ENV" |
      "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI" | "SESSION_SECRET" |
      "APP_CONFIG_ENCRYPTION_KEY"
    > = _parsed,
  ): void {
    const ports = [envInput.API_PORT, envInput.WEB_PORT, envInput.DB_PORT, envInput.REDIS_PORT];
    const unique = new Set(ports);
    if (unique.size !== ports.length) {
      throw new Error("Port conflict detected in env configuration");
    }

    if (envInput.NODE_ENV === "production" && envInput.AUTH_MODE === "dev_bypass") {
      throw new Error("AUTH_MODE=dev_bypass is not allowed in production");
    }

    if (envInput.AUTH_MODE === "oauth") {
      const missing = (["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "SESSION_SECRET"] as const)
        .filter((key) => !envInput[key]);
      if (missing.length > 0) {
        throw new Error(`AUTH_MODE=oauth requires the following env vars to be set: ${missing.join(", ")}`);
      }
    }

    // KZO-198: APP_CONFIG_ENCRYPTION_KEY is required in non-test runtimes so
    // Tier 0 secrets (FinMind, Twelve Data) can be encrypted/decrypted at the
    // app_config layer. Tests run with PERSISTENCE_BACKEND=memory and never
    // touch the encryption path, so we exempt NODE_ENV=test from the gate.
    if (envInput.NODE_ENV !== "test" && !envInput.APP_CONFIG_ENCRYPTION_KEY) {
      throw new Error(
        "APP_CONFIG_ENCRYPTION_KEY is required (64 lowercase hex chars). " +
        "Generate with `openssl rand -hex 32`.",
      );
    }

    Env.validateHostConsistency(_parsed);
    Env.validateCookieConfig(_parsed);
  },

  /**
   * Validates that session-critical URLs use consistent hostnames.
   * ALLOWED_ORIGINS is exempt — it legitimately lists multiple hosts for CORS.
   * Accepts an optional env-like object for unit testing.
   */
  validateHostConsistency(
    envInput: Pick<EnvConfig, "APP_BASE_URL" | "GOOGLE_REDIRECT_URI" | "API_PORT"> & Partial<Pick<EnvConfig, "NODE_ENV">> = _parsed,
  ): void {
    const urlsToCheck: Array<{ name: string; url: string }> = [];

    if (envInput.APP_BASE_URL) {
      urlsToCheck.push({ name: "APP_BASE_URL", url: envInput.APP_BASE_URL });
    }
    if (envInput.GOOGLE_REDIRECT_URI) {
      urlsToCheck.push({ name: "GOOGLE_REDIRECT_URI", url: envInput.GOOGLE_REDIRECT_URI });
    }

    const hostnames: Array<{ name: string; hostname: string }> = [];
    for (const { name, url } of urlsToCheck) {
      try {
        hostnames.push({ name, hostname: new URL(url).hostname });
      } catch {
        // Ignore unparseable URLs — schema validation will surface them if needed
      }
    }

    const uniqueHostnames = new Set(hostnames.map((item) => item.hostname));
    if (uniqueHostnames.size > 1) {
      // Only enforce consistency for localhost-style deployments where mixing
      // 'localhost' and '127.0.0.1' causes session/cookie failures.
      // Public subdomains (e.g. web.example.com vs api.example.com) are valid.
      const LOCALHOST_RE = /^(localhost|127\.0\.0\.1|::1)$/;
      const hasLocalhost = [...uniqueHostnames].some((h) => LOCALHOST_RE.test(h));
      if (hasLocalhost) {
        const description = hostnames.map(({ name, hostname }) => `${name}=${hostname}`).join(", ");
        throw new Error(
          `Hostname mismatch in session-critical URLs (${description}). ` +
          "Use 'localhost' consistently to avoid OAuth cookie/session failures.",
        );
      }
    }

    // Google redirect URI port validation — only in development mode.
    // In Docker/production, the redirect URI uses the host-mapped port (e.g., 4300)
    // which legitimately differs from API_PORT (e.g., 4000) due to port mapping.
    if (envInput.GOOGLE_REDIRECT_URI && envInput.NODE_ENV === "development") {
      try {
        const parsed = new URL(envInput.GOOGLE_REDIRECT_URI);
        if (parsed.port) {
          const redirectPort = Number(parsed.port);
          if (redirectPort !== envInput.API_PORT) {
            throw new Error(
              `GOOGLE_REDIRECT_URI port (${redirectPort}) does not match API_PORT (${envInput.API_PORT}).`,
            );
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("API_PORT")) {
          throw e;
        }
        // Ignore URL parse errors — already handled above
      }
    }
  },

  /**
   * Validates that COOKIE_DOMAIN and SESSION_COOKIE_NAME are compatible.
   * The __Host- cookie prefix prohibits the Domain attribute (RFC 6265bis); combining
   * the two would silently drop the Domain, leaving the cookie host-bound to the API
   * subdomain and invisible to the web proxy — reproducing the original auth bug.
   */
  validateCookieConfig(
    envInput: Pick<EnvConfig, "SESSION_COOKIE_NAME" | "COOKIE_DOMAIN"> = _parsed,
  ): void {
    if (envInput.COOKIE_DOMAIN && envInput.SESSION_COOKIE_NAME?.startsWith("__Host-")) {
      throw new Error(
        `COOKIE_DOMAIN="${envInput.COOKIE_DOMAIN}" is incompatible with ` +
        `SESSION_COOKIE_NAME="${envInput.SESSION_COOKIE_NAME}": ` +
        `the __Host- prefix prohibits the Domain cookie attribute (RFC 6265bis). ` +
        `Use a name without __Host- (e.g. "g_auth_session") when COOKIE_DOMAIN is set.`,
      );
    }
  },

  /** Build a GoogleOAuthEnvConfig from env vars. Returns null if any required var is absent. */
  getGoogleOAuthEnvConfig(): GoogleOAuthEnvConfig | null {
    if (!Env.GOOGLE_CLIENT_ID || !Env.GOOGLE_CLIENT_SECRET || !Env.GOOGLE_REDIRECT_URI || !Env.SESSION_SECRET) {
      return null;
    }
    return {
      clientId: Env.GOOGLE_CLIENT_ID,
      clientSecret: Env.GOOGLE_CLIENT_SECRET,
      redirectUri: Env.GOOGLE_REDIRECT_URI,
      sessionSecret: Env.SESSION_SECRET,
      ...(Env.GOOGLE_TOKEN_URL ? { tokenUrl: Env.GOOGLE_TOKEN_URL } : {}),
    };
  },

  getDatabaseUrl(): string {
    return Env.DB_URL ?? `postgres://app:app@127.0.0.1:${Env.DB_PORT}/tw_portfolio`;
  },

  getRedisUrl(): string {
    return Env.REDIS_URL ?? `redis://127.0.0.1:${Env.REDIS_PORT}`;
  },

  /** Normalize origin for comparison: trim and remove trailing slash (browser sends no path). */
  normalizeOrigin(origin: string): string {
    const t = origin.trim();
    return t.endsWith("/") ? t.slice(0, -1) : t;
  },

  getAllowedOrigins(): string[] {
    return (Env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((item) => Env.normalizeOrigin(item.trim()))
      .filter(Boolean);
  },
});

function loadDotEnvFile(dotenvPath: string): void {
  if (!fs.existsSync(dotenvPath)) return;

  const raw = fs.readFileSync(dotenvPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    // CRITICAL (P2): only set vars not already in process.env.
    // This preserves vitest's test.env override pattern.
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function loadDotEnv(): void {
  // Docker/CI override: use a specific file path if provided.
  if (process.env.APP_ENV_FILE) {
    loadDotEnvFile(process.env.APP_ENV_FILE);
    return;
  }

  // Walk up from the compiled file location to find the workspace root.
  // The root is identified by a package.json that contains a "workspaces" field.
  // Walk: libs/config/dist/ → libs/config/ (no workspaces) → libs/ → repo root (has workspaces).
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let dir = startDir;

  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
        if (pkg["workspaces"]) {
          loadDotEnvFile(path.join(dir, ".env.local"));
          return;
        }
      } catch {
        // Ignore JSON parse errors and continue walking up
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  // No workspace root found (e.g., Docker runtime where .env is excluded).
  // Skip gracefully — env vars are injected via Docker/CI environment.
}
