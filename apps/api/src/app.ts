import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { env, getAllowedOrigins, normalizeOrigin } from "./config/env.js";
import { createPersistence } from "./persistence/index.js";
import type { Persistence } from "./persistence/types.js";
import { registerRoutes } from "./routes/registerRoutes.js";

interface BuildAppOptions {
  persistenceBackend?: "postgres" | "memory";
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
  const userId = String(req.headers["x-authenticated-user-id"] ?? req.headers["x-user-id"] ?? "anonymous");
  const path = req.url.split("?")[0] ?? req.url;
  return `${req.ip}:${userId}:${req.method}:${path}`;
}

function isLocalDevOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export async function buildApp(options: BuildAppOptions = {}): Promise<AppInstance> {
  const app = Fastify({ logger: true }) as AppInstance;
  app.persistence = createPersistence(options.persistenceBackend);
  await app.persistence.init();

  app.addHook("onClose", async () => {
    await app.persistence.close();
  });

  const allowedOrigins = getAllowedOrigins();
  const normalizedAllowed = new Set(allowedOrigins.map(normalizeOrigin));
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (normalizedAllowed.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      if ((env.NODE_ENV === "development" || env.NODE_ENV === "test") && isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    },
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return;

    const key = getRateLimitKey(req);
    const now = Date.now();
    const windowMs = env.RATE_LIMIT_WINDOW_MS;
    const limit = env.RATE_LIMIT_MAX_MUTATIONS;
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

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
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

  await registerRoutes(app);
  return app;
}
