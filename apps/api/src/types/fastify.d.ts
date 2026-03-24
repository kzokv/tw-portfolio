import "fastify";
import type { Persistence } from "../persistence/types.js";
import type { GoogleOAuthConfig } from "../auth/googleOAuth.js";
import type { EventBus } from "../events/types.js";

declare module "fastify" {
  interface FastifyInstance {
    persistence: Persistence;
    eventBus: EventBus;
    oauthConfig: GoogleOAuthConfig | null;
    appBaseUrl: string;
  }
  interface FastifyRequest {
    __sessionType?: "demo" | "oauth";
  }
}
