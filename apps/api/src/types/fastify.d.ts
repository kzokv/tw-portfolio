import "fastify";
import type { Persistence } from "../persistence/types.js";
import type { GoogleOAuthConfig } from "../auth/googleOAuth.js";

declare module "fastify" {
  interface FastifyInstance {
    persistence: Persistence;
    oauthConfig: GoogleOAuthConfig | null;
    appBaseUrl: string;
  }
  interface FastifyRequest {
    __sessionType?: "demo" | "oauth";
  }
}
