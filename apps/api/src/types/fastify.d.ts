import "fastify";
import type { Persistence } from "../persistence/types.js";
import type { GoogleOAuthConfig } from "../auth/googleOAuth.js";
import type { BufferedEventBus } from "../events/buffered.js";
import type { PgBoss } from "pg-boss";

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
  }
}
