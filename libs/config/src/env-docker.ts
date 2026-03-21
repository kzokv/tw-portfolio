import { z } from "zod";
import { envSchema } from "./env-schema.js";

const dockerBaseExtension = {
  PUBLIC_DOMAIN_WEB: z.string().min(1),
  PUBLIC_DOMAIN_API: z.string().min(1),
  POSTGRES_USER: z.string().default("twp"),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().default("tw_portfolio"),
  REDIS_PASSWORD: z.string().min(1),
  CLOUDFLARE_TUNNEL_TOKEN: z.string().min(1),
  PRIMARY_PROVIDER: z.string().default("mock-primary"),
  FALLBACK_PROVIDER: z.string().default("mock-fallback"),
  TWP_STATE_DIR: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  DEPLOY_LOG_DIR: z.string().optional(),
  // Docker deployments route API and web through separate subdomains, so the session
  // cookie must be scoped to the shared parent domain rather than using __Host- (which
  // is host-bound). Override the base default so COOKIE_DOMAIN works out of the box.
  SESSION_COOKIE_NAME: z.string().min(1).default("g_auth_session"),
};

export const dockerDevSchema = envSchema.extend({
  ...dockerBaseExtension,
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  PUBLIC_DOMAIN_WEB: z.string().default("twp-dev-web.kzokvdevs.dpdns.org"),
  PUBLIC_DOMAIN_API: z.string().default("twp-dev-api.kzokvdevs.dpdns.org"),
  COOKIE_DOMAIN: z.string().default(".kzokvdevs.dpdns.org"),
});

export const dockerProdSchema = envSchema.extend({
  ...dockerBaseExtension,
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  PUBLIC_DOMAIN_WEB: z.string().default("twp-web.kzokvdevs.dpdns.org"),
  PUBLIC_DOMAIN_API: z.string().default("twp-api.kzokvdevs.dpdns.org"),
});

// Docker local — strict subset: only vars docker-compose.local.yml actually needs.
// Uses a standalone z.object() instead of extending envSchema because the local
// compose target passes ports as strings and only needs a narrow set of vars.
export const dockerLocalSchema = z.object({
  // Database
  POSTGRES_USER: z.string().default("twp"),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().default("tw_portfolio"),
  // Redis
  REDIS_PASSWORD: z.string().min(1),
  // Application
  // Note: NODE_ENV, API_PORT, and WEB_PORT are overridden by compose at runtime
  // via the service environment block in docker-compose.local.yml.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  API_PORT: z.string().default("4000"),
  WEB_PORT: z.string().default("3000"),
  DATA_PROVIDER_TIMEOUT_MS: z.string().default("3000"),
  PRIMARY_PROVIDER: z.string().default("mock-primary"),
  FALLBACK_PROVIDER: z.string().default("mock-fallback"),
  RATE_LIMIT_WINDOW_MS: z.string().default("60000"),
  RATE_LIMIT_MAX_MUTATIONS: z.string().default("120"),
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4300/auth/google/callback"),
  SESSION_SECRET: z.string().min(32),
  // Use g_auth_session (no __Host- prefix) since local Docker runs on HTTP,
  // and __Host- requires the Secure flag which needs HTTPS.
  SESSION_COOKIE_NAME: z.string().min(1).default("g_auth_session"),
  // Optional
  IMAGE_TAG: z.string().optional(),
});
