import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import {
  CONTEXT_FALLBACK_HEADER,
  contextClearCookieString,
  shouldStampContextFallback,
} from "./contextFallback.js";
import {
  getEffectiveSseHeartbeatIntervalMs,
  getEffectiveSseMaxConnectionsPerUser,
} from "../services/appConfig/sse.js";

/**
 * @deprecated KZO-198 — prefer `getEffectiveSseMaxConnectionsPerUser()`.
 * Retained as the env-default snapshot for places that consume it as a number.
 */
export const MAX_CONNECTIONS_PER_USER = 20;
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
 * Build the extra writeHead() headers for KZO-146's context-fallback signal.
 *
 * app.ts's onSend hook stamps x-context-fallback + a clear-cookie directive
 * via reply.header(), which Fastify only flushes when reply.send() is called.
 * SSE routes write directly to reply.raw and never call send(), so the onSend
 * hook never fires for them. We read the per-request flag (set by
 * hydrateAuthContext) and build the equivalent headers inline for writeHead().
 *
 * The handshake itself uses requireSessionUserId (ignores context), so the
 * connection opens even when context fallback is flagged. Propagating the
 * signal here lets the client tear down UI state at handshake time rather
 * than waiting for the next fetch response.
 */
function pickContextFallbackHeaders(
  req: FastifyRequest,
  reply: FastifyReply,
): { headers: Record<string, string>; setCookie: string[] } {
  if (!shouldStampContextFallback(req)) {
    return { headers: {}, setCookie: [] };
  }
  const existing = reply.getHeader("set-cookie");
  const cookies: string[] = [];
  if (Array.isArray(existing)) {
    cookies.push(...existing.map((value) => String(value)));
  } else if (existing !== undefined) {
    cookies.push(String(existing));
  }
  cookies.push(contextClearCookieString());
  return {
    headers: { [CONTEXT_FALLBACK_HEADER]: "revoked" },
    setCookie: cookies,
  };
}

/**
 * Resolve user ID for SSE route — always the session-owner user id (identity
 * surface, never the shared-context viewer target). Adds a `tw_e2e_user`
 * cookie fallback in dev_bypass mode for E2E test isolation (EventSource
 * cannot send custom headers).
 */
function resolveSSEUserId(
  req: FastifyRequest,
  requireSessionUserId: (req: FastifyRequest) => string,
): string {
  try {
    const sessionUserId = requireSessionUserId(req);
    if (Env.AUTH_MODE !== "oauth" && sessionUserId === "user-1") {
      const cookieUserId = parseE2ECookie(req);
      if (cookieUserId) return cookieUserId;
    }
    return sessionUserId;
  } catch {
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
  requireSessionUserId: (req: FastifyRequest) => string,
): void {
  app.get("/events/stream", async (req, reply) => {
    // 1. Resolve user ID
    const userId = resolveSSEUserId(req, requireSessionUserId);

    // 2. Connection limit check
    const currentCount = connectionCounts.get(userId) ?? 0;
    if (currentCount >= getEffectiveSseMaxConnectionsPerUser()) {
      const limitFallback = pickContextFallbackHeaders(req, reply);
      reply.raw.writeHead(200, {
        ...pickCorsHeaders(reply),
        ...limitFallback.headers,
        ...(limitFallback.setCookie.length > 0 ? { "set-cookie": limitFallback.setCookie } : {}),
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "connection_limit_exceeded" })}\n\n`);
      reply.raw.end();
      return reply;
    }

    // 3. Increment connection counter
    connectionCounts.set(userId, currentCount + 1);

    // 4. Parse Last-Event-ID for replay
    const lastEventIdHeader = req.headers["last-event-id"];
    let lastEventId: number | null = null;

    if (lastEventIdHeader && !Array.isArray(lastEventIdHeader)) {
      const parsed = parseInt(lastEventIdHeader, 10);
      if (!isNaN(parsed)) {
        lastEventId = parsed;
      }
    }

    // 5. Set SSE headers. pickCorsHeaders() propagates Access-Control-Allow-Origin
    //    and related headers set by @fastify/cors in the onRequest hook. Those
    //    headers live in Fastify's internal buffer (reply.header()) and are NOT
    //    flushed to reply.raw until reply.send() — which we intentionally skip for SSE.
    //    pickContextFallbackHeaders does the same for KZO-146's x-context-fallback
    //    + clear-cookie response that the onSend hook queues on revoked context.
    const connectFallback = pickContextFallbackHeaders(req, reply);
    reply.raw.writeHead(200, {
      ...pickCorsHeaders(reply),
      ...connectFallback.headers,
      ...(connectFallback.setCookie.length > 0 ? { "set-cookie": connectFallback.setCookie } : {}),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    // 6. Helper to write SSE frame with explicit seq + backpressure (KZO-118)
    function writeEvent(eventType: string, data: unknown, seq: number): void {
      try {
        const ok = reply.raw.write(
          `id: ${seq}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`,
        );
        if (!ok) {
          req.log.warn({
            msg: "sse_backpressure_drop",
            eventType,
            userId,
            seq,
          });
        }
      } catch {
        // Socket already destroyed — close handler will clean up
      }
    }

    // 7. Replay buffered events on reconnect
    if (lastEventId !== null) {
      const missed = app.eventBus.getEventsSince(userId, lastEventId);
      req.log.info({
        msg: "sse_replay",
        userId,
        lastEventId,
        replayedCount: missed.length,
      });
      for (const event of missed) {
        writeEvent(event.type, event.data, event.seq);
      }
    } else if (lastEventIdHeader) {
      // Non-parseable Last-Event-ID — log for debugging but don't replay
      req.log.info({ msg: "sse_reconnect_unparseable", userId, lastEventId: lastEventIdHeader });
    }

    // 8. Subscribe to EventBus — seq comes from BufferedEventBus
    const unsubscribe = app.eventBus.subscribe(userId, (event) => {
      writeEvent(event.type, event.data, event.seq ?? 0);
    });

    // 9. Heartbeat interval — uses BufferedEventBus.nextSeq().
    // KZO-198: read interval at connection setup (not inside the timer) so
    // the cadence stays stable per connection but admin overrides are picked
    // up by the next new connection.
    const heartbeatIntervalMs = getEffectiveSseHeartbeatIntervalMs();
    const heartbeatInterval = setInterval(() => {
      const hbSeq = app.eventBus.nextSeq(userId);
      writeEvent("heartbeat", {}, hbSeq);
    }, heartbeatIntervalMs);

    // 10. Cleanup on connection close
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
    const initialSeq = app.eventBus.nextSeq(userId);
    writeEvent("heartbeat", {}, initialSeq);

    return reply;
  });

  // Synthetic test endpoint
  app.post("/__test/publish-event", async (req) => {
    if (Env.NODE_ENV === "production") {
      throw routeError(404, "not_found", "not found");
    }

    const userId = requireSessionUserId(req);
    const body = z.object({ type: z.string().min(1), data: z.unknown().optional() }).parse(req.body);

    await app.eventBus.publishEvent(userId, body.type, body.data ?? {});
    return { published: true, type: body.type, userId };
  });
}

/** Exported for testing — reset connection state between tests. */
export function _resetConnectionCounts(): void {
  connectionCounts.clear();
}
