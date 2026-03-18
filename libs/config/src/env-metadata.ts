export interface EnvGroup {
  label: string;
  keys: string[];
}

// Root env groups (matches .env.example section ordering)
export const envGroups: EnvGroup[] = [
  { label: "Environment & modes", keys: ["NODE_ENV", "AUTH_MODE", "PERSISTENCE_BACKEND"] },
  { label: "Application ports", keys: ["API_PORT", "WEB_PORT", "DB_PORT", "REDIS_PORT"] },
  { label: "Database/Redis URLs", keys: ["DB_URL", "REDIS_URL"] },
  { label: "Market data providers", keys: ["DATA_PROVIDER_TIMEOUT_MS", "PRIMARY_PROVIDER", "FALLBACK_PROVIDER"] },
  { label: "Security/Tuning", keys: ["ALLOWED_ORIGINS", "RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_MAX_MUTATIONS"] },
  {
    label: "Google OAuth",
    keys: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "SESSION_SECRET",
      "SESSION_COOKIE_NAME",
      "COOKIE_DOMAIN",
      "GOOGLE_TOKEN_URL",
      "APP_BASE_URL",
    ],
  },
];

// Docker dev groups
export const dockerDevGroups: EnvGroup[] = [
  { label: "Public domains", keys: ["PUBLIC_DOMAIN_WEB", "PUBLIC_DOMAIN_API"] },
  { label: "Postgres", keys: ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"] },
  { label: "Redis", keys: ["REDIS_PASSWORD"] },
  { label: "Cloudflare Tunnel", keys: ["CLOUDFLARE_TUNNEL_TOKEN"] },
  { label: "Google OAuth", keys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "SESSION_COOKIE_NAME", "COOKIE_DOMAIN"] },
  {
    label: "Application",
    keys: [
      "NODE_ENV",
      "AUTH_MODE",
      "AUTH_USER_ID",
      "PERSISTENCE_BACKEND",
      "API_PORT",
      "WEB_PORT",
      "DATA_PROVIDER_TIMEOUT_MS",
      "PRIMARY_PROVIDER",
      "FALLBACK_PROVIDER",
      "RATE_LIMIT_WINDOW_MS",
      "RATE_LIMIT_MAX_MUTATIONS",
    ],
  },
  { label: "State paths", keys: ["TWP_STATE_DIR", "BACKUP_DIR", "DEPLOY_LOG_DIR"] },
];

// Docker prod groups — same structure as dev
export const dockerProdGroups: EnvGroup[] = [
  { label: "Public domains", keys: ["PUBLIC_DOMAIN_WEB", "PUBLIC_DOMAIN_API"] },
  { label: "Postgres", keys: ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"] },
  { label: "Redis", keys: ["REDIS_PASSWORD"] },
  { label: "Cloudflare Tunnel", keys: ["CLOUDFLARE_TUNNEL_TOKEN"] },
  { label: "Google OAuth", keys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "SESSION_COOKIE_NAME", "COOKIE_DOMAIN"] },
  {
    label: "Application",
    keys: [
      "NODE_ENV",
      "AUTH_MODE",
      "AUTH_USER_ID",
      "PERSISTENCE_BACKEND",
      "API_PORT",
      "WEB_PORT",
      "DATA_PROVIDER_TIMEOUT_MS",
      "PRIMARY_PROVIDER",
      "FALLBACK_PROVIDER",
      "RATE_LIMIT_WINDOW_MS",
      "RATE_LIMIT_MAX_MUTATIONS",
    ],
  },
  { label: "State paths", keys: ["TWP_STATE_DIR", "BACKUP_DIR", "DEPLOY_LOG_DIR"] },
];

// Web env groups
export const webEnvGroups: EnvGroup[] = [
  { label: "Web app", keys: ["NEXT_PUBLIC_AUTH_MODE", "NEXT_PUBLIC_API_BASE_URL"] },
];

// Sensitive keys — masked input in prompts
export const sensitiveKeys = new Set([
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "CLOUDFLARE_TUNNEL_TOKEN",
]);

// Auto-generatable keys — offer crypto.randomBytes(32).toString('hex')
export const autoGenerateKeys = new Set([
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "SESSION_SECRET",
]);
