import "fastify";
import type { Persistence } from "../persistence/types.js";
import type { GoogleOAuthConfig } from "../auth/googleOAuth.js";
import type { BufferedEventBus } from "../events/buffered.js";
import type { PgBoss } from "pg-boss";
import type { UserRole } from "../persistence/types.js";
import type { MarketDataRegistry } from "../services/market-data/registry.js";

interface RequestImpersonationContext {
  active: boolean;
  targetUserId: string;
  targetEmail: string | null;
  expiresAt: string;
}

interface RequestAuthContext {
  sessionUserId: string;
  contextUserId: string;
  role: UserRole;
  sessionVersion: number;
  isDemo: boolean;
  isImpersonating: boolean;
  isSharedContext: boolean;
  email?: string | null;
  impersonation: RequestImpersonationContext | null;
}

declare module "fastify" {
  interface FastifyInstance {
    persistence: Persistence;
    eventBus: BufferedEventBus;
    oauthConfig: GoogleOAuthConfig | null;
    appBaseUrl: string;
    boss: PgBoss | null;
    marketDataRegistry: MarketDataRegistry;
  }
  interface FastifyRequest {
    __sessionType?: "demo" | "oauth";
    __contextFallback?: boolean;
    __clearSessionCookie?: boolean;
    __clearImpersonationCookie?: boolean;
    authContext?: RequestAuthContext;
  }
}
