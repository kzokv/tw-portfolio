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
  AUTH_USER_ID: z.string().default("user-1"),
  PRIMARY_PROVIDER: z.string().default("mock-primary"),
  FALLBACK_PROVIDER: z.string().default("mock-fallback"),
  TWP_STATE_DIR: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  DEPLOY_LOG_DIR: z.string().optional(),
};

export const dockerDevSchema = envSchema.extend({
  ...dockerBaseExtension,
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  PUBLIC_DOMAIN_WEB: z.string().default("twp-dev-web.kzokvdevs.dpdns.org"),
  PUBLIC_DOMAIN_API: z.string().default("twp-dev-api.kzokvdevs.dpdns.org"),
});

export const dockerProdSchema = envSchema.extend({
  ...dockerBaseExtension,
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  PUBLIC_DOMAIN_WEB: z.string().default("twp-web.kzokvdevs.dpdns.org"),
  PUBLIC_DOMAIN_API: z.string().default("twp-api.kzokvdevs.dpdns.org"),
});
