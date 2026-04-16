import "fastify";
import type { Persistence } from "../persistence/types.js";
import type { GoogleOAuthConfig } from "../auth/googleOAuth.js";
import type { BufferedEventBus } from "../events/buffered.js";
import type { PgBoss } from "pg-boss";
import type { UserRole } from "../persistence/types.js";

interface RequestAuthContext {
  sessionUserId: string;
  contextUserId: string;
  role: UserRole;
  sessionVersion: number;
  isDemo: boolean;
  isImpersonating: boolean;
  email?: string | null;
}

declare module "fastify" {
  interface FastifyInstance {
    persistence: Persistence;
    eventBus: BufferedEventBus;
    oauthConfig: GoogleOAuthConfig | null;
    appBaseUrl: string;
    boss: PgBoss | null;
  }
  interface FastifyRequest {
    __sessionType?: "demo" | "oauth";
    authContext?: RequestAuthContext;
  }
}
