import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Env } from "@tw-portfolio/config";
import { routeError } from "../lib/routeError.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CONNECTIONS_PER_USER = 5;
const E2E_USER_COOKIE = "tw_e2e_user";

// Per-user connection counter (module-scoped, cleared on app close)
const connectionCounts = new Map<string, number>();

/**
 * Pick CORS headers stored by @fastify/cors in the onRequest hook so they can
 * be included when calling reply.raw.writeHead() directly.
 * reply.header() stores headers in Fastify's internal buffer — they are not
 * flushed to reply.raw until reply.send() is called, which we deliberately
 * skip for SSE. This helper bridges that gap.
 */
function pickCorsHeaders(reply: FastifyReply): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const key of ["access-control-allow-origin", "access-control-allow-credentials", "vary"]) {
    const val = reply.getHeader(key);
    if (val !== undefined) headers[key] = String(val);
  }
  return headers;
}

/**
 * Resolve user ID for SSE route.
 * Delegates to the shared resolveUserId for standard auth, with an additional
 * tw_e2e_user cookie fallback in dev_bypass mode for E2E test isolation
 * (EventSource cannot send custom headers).
 */
function resolveSSEUserId(
  req: FastifyRequest,
  resolveUserId: (req: FastifyRequest, sessionSecret?: string) => { userId: string; isDemo: boolean },
  sessionSecret?: string,
): string {
  // Try standard resolveUserId first (handles oauth + dev_bypass header)
  try {
    const { userId } = resolveUserId(req, sessionSecret);
    // In dev_bypass mode, if we got the default "user-1" back, check for
    // the tw_e2e_user cookie as a more specific fallback.
    if (Env.AUTH_MODE !== "oauth" && userId === "user-1") {
      const cookieUserId = parseE2ECookie(req);
      if (cookieUserId) return cookieUserId;
    }
    return userId;
  } catch {
    // In oauth mode, resolveUserId throws 401 if no session.
    // Re-throw — SSE connections require auth.
    throw routeError(401, "auth_required", "authentication required");
  }
}

function parseE2ECookie(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    if (part.slice(0, eqIdx).trim() === E2E_USER_COOKIE) {
      try {
        const value = decodeURIComponent(part.slice(eqIdx + 1).trim());
        if (value) return value;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function registerSSERoute(
  app: FastifyInstance,
  resolveUserId: (req: FastifyRequest, sessionSecret?: string) => { userId: string; isDemo: boolean },
): void {
  app.get("/events/stream", async (req, reply) => {
    // 1. Resolve user ID
    const userId = resolveSSEUserId(req, resolveUserId, app.oauthConfig?.sessionSecret);

    // 2. Connection limit check
    const currentCount = connectionCounts.get(userId) ?? 0;
    if (currentCount >= MAX_CONNECTIONS_PER_USER) {
      reply.raw.writeHead(200, {
        ...pickCorsHeaders(reply),
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "connection_limit_exceeded" })}\n\n`);
      reply.raw.end();
      return reply;
    }

    // 3. Increment connection counter
    connectionCounts.set(userId, currentCount + 1);

    // 4. Parse Last-Event-ID for telemetry
    const lastEventIdHeader = req.headers["last-event-id"];
    let seq = 0;

    if (lastEventIdHeader && !Array.isArray(lastEventIdHeader)) {
      const parsed = parseInt(lastEventIdHeader, 10);
      if (!isNaN(parsed)) {
        req.log.info({
          msg: "sse_reconnect",
          userId,
          lastEventId: parsed,
          gapSize: "unknown_new_connection",
        });
      }
    }

    // 5. Set SSE headers. pickCorsHeaders() propagates Access-Control-Allow-Origin
    //    and related headers set by @fastify/cors in the onRequest hook. Those
    //    headers live in Fastify's internal buffer (reply.header()) and are NOT
    //    flushed to reply.raw until reply.send() — which we intentionally skip for SSE.
    reply.raw.writeHead(200, {
      ...pickCorsHeaders(reply),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // 6. Helper to write SSE frame
    function writeEvent(eventType: string, data: unknown): void {
      seq++;
      reply.raw.write(`id: ${seq}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    // 7. Subscribe to EventBus
    const unsubscribe = app.eventBus.subscribe(userId, (event) => {
      writeEvent(event.type, event.data);
    });

    // 8. Heartbeat interval
    const heartbeatInterval = setInterval(() => {
      writeEvent("heartbeat", {});
    }, HEARTBEAT_INTERVAL_MS);

    // 9. Cleanup on connection close
    req.raw.on("close", () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
      const count = connectionCounts.get(userId) ?? 1;
      if (count <= 1) {
        connectionCounts.delete(userId);
      } else {
        connectionCounts.set(userId, count - 1);
      }
    });

    // Send initial heartbeat to confirm connection
    writeEvent("heartbeat", {});

    return reply;
  });

  // Synthetic test endpoint
  app.post("/__test/publish-event", async (req) => {
    if (Env.NODE_ENV === "production") {
      throw routeError(404, "not_found", "not found");
    }

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z.object({ type: z.string().min(1), data: z.unknown().optional() }).parse(req.body);

    await app.eventBus.publishEvent(userId, body.type, body.data ?? {});
    return { published: true, type: body.type, userId };
  });
}

/** Exported for testing — reset connection state between tests. */
export function _resetConnectionCounts(): void {
  connectionCounts.clear();
}
