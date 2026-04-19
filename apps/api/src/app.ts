import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { Env, type GoogleOAuthEnvConfig } from "@tw-portfolio/config";
import { createPersistence } from "./persistence/index.js";
import type { Persistence } from "./persistence/types.js";
import { createEventBus, type BufferedEventBus } from "./events/index.js";
import {
  CONTEXT_FALLBACK_HEADER,
  contextClearCookieString,
  enforceRouteRole,
  hydrateAuthContext,
  isPublicRoute,
  registerRoutes,
  shouldStampContextFallback,
} from "./routes/registerRoutes.js";
import { registerPgBoss } from "./plugins/pgBoss.js";
import type { GoogleOAuthConfig } from "./auth/googleOAuth.js";
// Compile-time check: GoogleOAuthEnvConfig must remain assignable to GoogleOAuthConfig (P10).
// If fields ever drift, this line fails to compile and surfaces the problem immediately.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertAssignable = GoogleOAuthEnvConfig extends GoogleOAuthConfig ? true : never;

interface BuildAppOptions {
  persistenceBackend?: "postgres" | "memory";
  seedMemoryCatalog?: boolean;
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

async function bootstrapAdminAccess(app: AppInstance): Promise<void> {
  if (Env.AUTH_MODE === "dev_bypass") {
    await app.persistence.ensureDevBypassUser();
    return;
  }

  if (!Env.INITIAL_ADMIN_EMAIL) {
    app.log.warn({ msg: "admin_bootstrap_missing", reason: "no admin bootstrap configured" });
    return;
  }

  const existing = await app.persistence.getAuthUserByEmail(Env.INITIAL_ADMIN_EMAIL);
  if (!existing) {
    app.log.warn({
      msg: "admin_bootstrap_pending",
      email: Env.INITIAL_ADMIN_EMAIL,
      reason: "no user matches INITIAL_ADMIN_EMAIL; admin will be promoted on first sign-in",
    });
    return;
  }

  if (existing.deactivatedAt || existing.deletedAt) {
    app.log.warn({
      msg: "admin_bootstrap_skipped_inactive_user",
      email: Env.INITIAL_ADMIN_EMAIL,
      userId: existing.userId,
    });
    return;
  }

  await app.persistence.promoteUserToAdminByEmail(Env.INITIAL_ADMIN_EMAIL, "admin_promote_startup");
}

// KZO-147: redact the 22-char base62 token in GET /share/:token URLs so the
// plaintext token does not leak into request logs.
const ANON_SHARE_TOKEN_URL_REGEX = /\/share\/[A-Za-z0-9]{22}(?=[/?#]|$)/g;
function redactAnonymousShareTokenUrl(url: string): string {
  return url.replace(ANON_SHARE_TOKEN_URL_REGEX, "/share/[REDACTED]");
}

export async function buildApp(options: BuildAppOptions = {}): Promise<AppInstance> {
  const app = Fastify({
    logger: {
      serializers: {
        req(request: { method?: string; url?: string; hostname?: string; remoteAddress?: string; remotePort?: number }) {
          return {
            method: request.method,
            url: typeof request.url === "string" ? redactAnonymousShareTokenUrl(request.url) : request.url,
            hostname: request.hostname,
            remoteAddress: request.remoteAddress,
            remotePort: request.remotePort,
          };
        },
      },
    },
  }) as AppInstance;
  app.decorateRequest("__sessionType", undefined);
  const persistenceBackend = options.persistenceBackend ?? Env.PERSISTENCE_BACKEND;
  const seedMemoryCatalog = options.seedMemoryCatalog ?? (persistenceBackend === "memory" && Env.NODE_ENV !== "test");
  const seedDevBypassUser = persistenceBackend === "memory" && Env.AUTH_MODE === "dev_bypass";
  app.persistence = createPersistence(persistenceBackend, { seedMemoryCatalog, seedDevBypassUser });
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
  await bootstrapAdminAccess(app);

  // KZO-37: Fire-and-forget dividend ledger backfill on boot. Brings stored
  // expected_cash_amount / eligible_quantity / expected_stock_quantity into
  // sync with current trades for any entries that were posted before Rule B
  // recompute went live. Does NOT reset reconciliation_status (4b).
  // Deferred to setImmediate so the ready-check is never blocked.
  setImmediate(async () => {
    try {
      const { runDividendLedgerBackfill } = await import("./services/dividends.js");
      const applied = await runDividendLedgerBackfill(app.persistence);
      if (applied > 0) {
        app.log.info({ msg: "dividend_ledger_backfill_applied", count: applied });
      }
    } catch (error) {
      app.log.warn({
        msg: "dividend_ledger_backfill_failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

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
    if (shouldStampContextFallback(req)) {
      reply.header(CONTEXT_FALLBACK_HEADER, "revoked");
      const clearCookie = contextClearCookieString();
      const existing = reply.getHeader("set-cookie");
      if (existing === undefined) {
        reply.header("set-cookie", clearCookie);
      } else if (Array.isArray(existing)) {
        reply.header("set-cookie", [...existing, clearCookie]);
      } else {
        reply.header("set-cookie", [String(existing), clearCookie]);
      }
    }
  });

  app.addHook("preHandler", async (req) => {
    const routeUrl = req.routeOptions.url;
    if (!routeUrl || isPublicRoute(req.method, routeUrl)) {
      return;
    }

    await hydrateAuthContext(app, req);
    enforceRouteRole(req);
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
  await registerPgBoss(app, options.persistenceBackend);
  return app;
}
