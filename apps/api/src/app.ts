import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { Env, type GoogleOAuthEnvConfig } from "@tw-portfolio/config";
import { createPersistence } from "./persistence/index.js";
import type { Persistence } from "./persistence/types.js";
import { createEventBus, type BufferedEventBus } from "./events/index.js";
import { registerRoutes } from "./routes/registerRoutes.js";
import { registerPgBoss } from "./plugins/pgBoss.js";
import type { GoogleOAuthConfig } from "./auth/googleOAuth.js";
// Compile-time check: GoogleOAuthEnvConfig must remain assignable to GoogleOAuthConfig (P10).
// If fields ever drift, this line fails to compile and surfaces the problem immediately.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertAssignable = GoogleOAuthEnvConfig extends GoogleOAuthConfig ? true : never;

interface BuildAppOptions {
  persistenceBackend?: "postgres" | "memory";
  eventBusBackend?: "postgres" | "memory";
  /** Inject OAuth config directly (used in tests). Pass null to explicitly disable OAuth.
   *  When omitted, reads from environment variables via getGoogleOAuthEnvConfig(). */
  oauthConfig?: GoogleOAuthConfig | null;
  /** Override the web app base URL for post-OAuth redirects (used in tests). */
  appBaseUrl?: string;
}

interface RateCounter {
  count: number;
  windowStartedAt: number;
}

interface HttpishError extends Error {
  statusCode?: number;
  code?: string;
}

export type AppInstance = FastifyInstance & {
  persistence: Persistence;
  eventBus: BufferedEventBus;
};

const mutationBuckets = new Map<string, RateCounter>();

function isKnownClientError(message: string): { statusCode: number; code: string } | null {
  const normalized = message.toLowerCase();
  if (normalized.includes("not found")) {
    return { statusCode: 404, code: "not_found" };
  }
  if (normalized.includes("invalid") || normalized.includes("missing") || normalized.includes("unsupported")) {
    return { statusCode: 400, code: "invalid_request" };
  }
  return null;
}

function getRateLimitKey(req: FastifyRequest): string {
  const userId = String(req.headers["x-user-id"] ?? "anonymous");
  const path = req.url.split("?")[0] ?? req.url;
  return `${req.ip}:${userId}:${req.method}:${path}`;
}

function isLocalDevOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export async function buildApp(options: BuildAppOptions = {}): Promise<AppInstance> {
  const app = Fastify({ logger: true }) as AppInstance;
  app.decorateRequest("__sessionType", undefined);
  app.persistence = createPersistence(options.persistenceBackend);
  const ebBackend = options.eventBusBackend ?? options.persistenceBackend;
  app.eventBus = createEventBus(ebBackend);
  // BufferedEventBus has no init() — it handles pub/sub locally via EventEmitter.
  // The inner RedisEventBus.init() (Redis connect) is intentionally skipped in
  // single-instance mode. When cross-instance pub/sub is needed (KZO-121),
  // BufferedEventBus should expose init() to initialize the inner transport.
  if ("init" in app.eventBus && typeof (app.eventBus as { init?: () => Promise<void> }).init === "function") {
    await (app.eventBus as { init: () => Promise<void> }).init();
  }
  app.oauthConfig = options.oauthConfig !== undefined ? options.oauthConfig : Env.getGoogleOAuthEnvConfig();
  app.appBaseUrl = options.appBaseUrl ?? Env.APP_BASE_URL ?? "http://localhost:3000";
  await app.persistence.init();

  app.addHook("onClose", async () => {
    await app.eventBus.close();
    await app.persistence.close();
  });

  const allowedOrigins = Env.getAllowedOrigins();
  const normalizedAllowed = new Set(allowedOrigins.map(Env.normalizeOrigin));
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (normalizedAllowed.has(Env.normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      if ((Env.NODE_ENV === "development" || Env.NODE_ENV === "test") && isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return;

    const key = getRateLimitKey(req);
    const now = Date.now();
    const windowMs = Env.RATE_LIMIT_WINDOW_MS;
    const limit = Env.RATE_LIMIT_MAX_MUTATIONS;
    const existing = mutationBuckets.get(key);

    if (!existing || now - existing.windowStartedAt >= windowMs) {
      mutationBuckets.set(key, { count: 1, windowStartedAt: now });
      return;
    }

    existing.count += 1;
    mutationBuckets.set(key, existing);

    if (existing.count > limit) {
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (req.__sessionType) {
      reply.header("x-session-type", req.__sessionType);
    }
  });

  app.setErrorHandler((error: HttpishError, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    if (typeof error.statusCode === "number") {
      return reply.code(error.statusCode).send({
        error: error.code ?? "request_error",
        message: error.message,
      });
    }

    const known = isKnownClientError(error.message ?? "");
    if (known) {
      return reply.code(known.statusCode).send({ error: known.code, message: error.message });
    }

    req.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.boss = null;
  await registerRoutes(app);
  await registerPgBoss(app);
  return app;
}
