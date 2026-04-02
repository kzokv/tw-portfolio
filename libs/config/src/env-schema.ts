import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  DB_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  DATA_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_MUTATIONS: z.coerce.number().int().positive().default(120),
  // Google OAuth — required when AUTH_MODE=oauth.
  // GOOGLE_CLIENT_ID: OAuth 2.0 client ID from Google Cloud Console credentials.
  // GOOGLE_CLIENT_SECRET: paired secret; never expose to clients.
  // GOOGLE_REDIRECT_URI: must exactly match a URI registered in Google Cloud Console
  //   (e.g. https://api.example.com/auth/google/callback).
  // SESSION_SECRET: random string >= 32 chars used for HMAC CSRF state signing;
  //   rotating this value invalidates all in-flight OAuth flows.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  // Default is "g_auth_session" (no __Host- prefix) so cookies work on HTTP localhost.
  // Production HTTPS deploys should set SESSION_COOKIE_NAME=__Host-g_auth_session explicitly.
  SESSION_COOKIE_NAME: z.string().min(1).default("g_auth_session"),
  GOOGLE_TOKEN_URL: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  // COOKIE_DOMAIN: when set, the session cookie is scoped to this domain (e.g. ".kzokvdevs.dpdns.org")
  // so it is shared across API and web subdomains. Required when those subdomains differ.
  // Must not be set when SESSION_COOKIE_NAME starts with "__Host-" (incompatible prefix).
  COOKIE_DOMAIN: z.string().optional(),
  DEMO_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
  DEMO_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  // FinMind API token — required for market data backfill (KZO-126).
  // Free tier: 600 requests/hour. Obtain from https://finmindtrade.com/
  FINMIND_API_TOKEN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Generation schema for root:local target. Includes NEXT_PUBLIC_* for Next.js. */
export const rootLocalSchema = envSchema.extend({
  NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
  NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
  // Host credentials — used for SSH tunnel from Lume VM to Mac host.
  // Required when running Docker full stack inside the VM and accessing web via localhost.
  MAC_USER: z.string().optional(),
  MAC_PASSWORD: z.string().optional(),
});

/**
 * Web-side env schema. Safe to import in Edge Runtime (no Node.js modules).
 * SESSION_SECRET is inherited as optional from envSchema. Enforcement (required in
 * oauth mode) relies on validateEnvConstraints() — webEnvSchema.parse() alone will
 * not throw if SESSION_SECRET is absent.
 */
export const webEnvSchema = envSchema
  .pick({ SESSION_SECRET: true, SESSION_COOKIE_NAME: true, COOKIE_DOMAIN: true })
  .extend({
    NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
    NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
    /** Server-side API base URL. In Docker, route handlers fetch via container network
     *  (e.g. http://twp-local-api:4000) instead of the host-published port. */
    SERVER_API_BASE_URL: z.string().url().optional(),
    DEMO_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
  });

export type WebEnvConfig = z.infer<typeof webEnvSchema>;

export function parseDotEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();
  // Strip inline comment (" # comment") so enum/number parsing succeeds
  const commentStart = value.indexOf(" #");
  if (commentStart !== -1) value = value.slice(0, commentStart).trim();
  // Strip surrounding quotes
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}
