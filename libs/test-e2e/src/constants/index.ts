export const ROUTES = {
  DASHBOARD: "/dashboard",
  PORTFOLIO: "/portfolio",
  TRANSACTIONS: "/transactions",
  LOGIN: "/login",
  AUTH_ERROR: "/auth/error",
  SETTINGS_DRAWER: "/dashboard?drawer=settings",
} as const;

export const E2E_ENDPOINTS = {
  RESET: "/__e2e/reset",
  OAUTH_SESSION: "/__e2e/oauth-session",
  DEMO_SESSION: "/__e2e/demo-session",
  RESET_DEMO_RATE_BUCKETS: "/__e2e/reset-demo-rate-buckets",
} as const;

export const TIMEOUTS = {
  APP_READY: 30_000,
  SSE_HEARTBEAT: 15_000,
  DEFAULT: 10_000,
} as const;

export const TEST_DATA = {
  TICKER_SYMBOL: "2330",
} as const;
