# Technical Design — KZO-113: Generic SSE Infrastructure with Redis Pub/Sub Bridge

Date: 2026-03-23

## Summary

Build a generic Server-Sent Events (SSE) infrastructure: EventBus abstraction (InMemory + Redis), SSE streaming route, event type registry, synthetic test endpoint, `useEventStream` React hook, and full test coverage across integration and E2E suites.

## Architecture

```
Browser (EventSource)  ──►  Fastify GET /events/stream  ◄──  Redis Pub/Sub  ◄──  Background work
                             │                                    │
                             ├── InMemoryEventBus (test/dev)      ├── RedisEventBus (prod)
                             └── Per-user channels                └── 2 connections (pub + sub)
```

---

## File-by-File Implementation Plan

### 1. Event Type Registry — `libs/shared-types/src/events.ts` (NEW)

TypeScript discriminated union for all SSE event types. Exported from `libs/shared-types/src/index.ts`.

```ts
// System event types
export interface HeartbeatEvent {
  type: "heartbeat";
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message?: string;
}

// Domain event types
export interface RecomputeCompleteEvent {
  type: "recompute_complete";
  portfolioId?: string;
}

// Discriminated union
export type SSEEvent = HeartbeatEvent | ErrorEvent | RecomputeCompleteEvent;

// System types (used internally for SSE wire format)
export type SSESystemEventType = "heartbeat" | "error";
export type SSEDomainEventType = "recompute_complete";
export type SSEEventType = SSESystemEventType | SSEDomainEventType;
```

**Update:** `libs/shared-types/src/index.ts` — add `export * from "./events.js";`

### 2. EventBus Interface — `apps/api/src/events/types.ts` (NEW)

```ts
export type EventHandler = (event: { type: string; data: unknown }) => void;
export type Unsubscribe = () => void;

export interface EventBus {
  /** Publish an event to a user's channel. */
  publishEvent(userId: string, type: string, payload: unknown): Promise<void>;

  /** Subscribe to a user's channel. Returns an unsubscribe function. */
  subscribe(userId: string, handler: EventHandler): Unsubscribe;

  /** Graceful shutdown — close connections, clear listeners. */
  close(): Promise<void>;
}
```

### 3. InMemoryEventBus — `apps/api/src/events/memory.ts` (NEW)

```ts
import { EventEmitter } from "node:events";
import type { EventBus, EventHandler, Unsubscribe } from "./types.js";

export class InMemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (one per SSE connection per user)
    this.emitter.setMaxListeners(0);
  }

  async publishEvent(userId: string, type: string, payload: unknown): Promise<void> {
    this.emitter.emit(`events:${userId}`, { type, data: payload });
  }

  subscribe(userId: string, handler: EventHandler): Unsubscribe {
    const channel = `events:${userId}`;
    this.emitter.on(channel, handler);
    return () => { this.emitter.off(channel, handler); };
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
```

### 4. RedisEventBus — `apps/api/src/events/redis.ts` (NEW)

```ts
import { createClient, type RedisClientType } from "redis";
import type { EventBus, EventHandler, Unsubscribe } from "./types.js";

export interface RedisEventBusOptions {
  redisUrl: string;
}

export class RedisEventBus implements EventBus {
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly options: RedisEventBusOptions) {
    this.publisher = createClient({ url: options.redisUrl });
    this.subscriber = createClient({ url: options.redisUrl });

    // Prevent unhandled error crashes (required for pub/sub connections)
    this.subscriber.on("error", (err) => {
      console.error("[RedisEventBus] subscriber error:", err);
    });
    this.publisher.on("error", (err) => {
      console.error("[RedisEventBus] publisher error:", err);
    });
  }

  async init(): Promise<void> {
    await this.publisher.connect();
    await this.subscriber.connect();
  }

  async publishEvent(userId: string, type: string, payload: unknown): Promise<void> {
    const channel = `events:${userId}`;
    const message = JSON.stringify({ type, data: payload });
    await this.publisher.publish(channel, message);
  }

  subscribe(userId: string, handler: EventHandler): Unsubscribe {
    const channel = `events:${userId}`;
    const existing = this.handlers.get(channel);

    if (existing) {
      existing.add(handler);
    } else {
      const handlerSet = new Set<EventHandler>([handler]);
      this.handlers.set(channel, handlerSet);

      // Subscribe to Redis channel — dispatch to all local handlers
      this.subscriber.subscribe(channel, (message) => {
        const parsed = JSON.parse(message) as { type: string; data: unknown };
        for (const h of handlerSet) h(parsed);
      });
    }

    return () => {
      const set = this.handlers.get(channel);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        this.subscriber.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    // Unsubscribe all channels
    for (const channel of this.handlers.keys()) {
      await this.subscriber.unsubscribe(channel);
    }
    this.handlers.clear();

    if (this.subscriber.isOpen) await this.subscriber.quit();
    if (this.publisher.isOpen) await this.publisher.quit();
  }
}
```

**Redis connection budget:** Total 3 connections (1 persistence command, 1 EventBus publisher, 1 EventBus subscriber).

### 5. EventBus Factory — `apps/api/src/events/index.ts` (NEW)

Mirrors `createPersistence()` pattern.

```ts
import { Env } from "@tw-portfolio/config";
import { InMemoryEventBus } from "./memory.js";
import { RedisEventBus } from "./redis.js";
import type { EventBus } from "./types.js";

export type { EventBus } from "./types.js";

export function createEventBus(backend: "postgres" | "memory" = Env.PERSISTENCE_BACKEND): EventBus {
  if (backend === "memory") {
    return new InMemoryEventBus();
  }
  return new RedisEventBus({ redisUrl: Env.getRedisUrl() });
}
```

### 6. App Lifecycle Wiring — `apps/api/src/app.ts` (MODIFY)

Changes:
1. Import `createEventBus` and `EventBus` type
2. Extend `AppInstance` type: `FastifyInstance & { persistence: Persistence; eventBus: EventBus; }`
3. In `buildApp()`: create EventBus, attach to app, init if Redis, register `onClose` hook
4. Add `eventBusBackend` to `BuildAppOptions` (optional, defaults to same as `persistenceBackend`)

```ts
// In BuildAppOptions:
interface BuildAppOptions {
  persistenceBackend?: "postgres" | "memory";
  eventBusBackend?: "postgres" | "memory"; // defaults to persistenceBackend
  // ... existing fields
}

// In AppInstance:
export type AppInstance = FastifyInstance & {
  persistence: Persistence;
  eventBus: EventBus;
};

// In buildApp():
const ebBackend = options.eventBusBackend ?? options.persistenceBackend;
app.eventBus = createEventBus(ebBackend);
if ("init" in app.eventBus && typeof app.eventBus.init === "function") {
  await (app.eventBus as { init: () => Promise<void> }).init();
}

app.addHook("onClose", async () => {
  await app.eventBus.close();
});
```

**Note:** The `onSend` security headers hook fires once on the initial SSE 200 response — this is harmless for `text/event-stream`. No changes needed to the security headers.

### 7. SSE Route — `apps/api/src/routes/sseRoute.ts` (NEW)

Registered from `registerRoutes.ts`. Separate file to keep registerRoutes manageable.

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Env } from "@tw-portfolio/config";

// Constants
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CONNECTIONS_PER_USER = 5;
const E2E_USER_COOKIE = "tw_e2e_user";

// Per-user connection counter (module-scoped, cleared on app close)
const connectionCounts = new Map<string, number>();

export function registerSSERoute(app: FastifyInstance): void {
  app.get("/events/stream", async (req, reply) => {
    // 1. Resolve user ID
    const userId = resolveSSEUserId(req, app);

    // 2. Connection limit check
    const currentCount = connectionCounts.get(userId) ?? 0;
    if (currentCount >= MAX_CONNECTIONS_PER_USER) {
      // Accept connection, send error event, close (NOT raw 429)
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      });
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "connection_limit_exceeded" })}\n\n`);
      reply.raw.end();
      return reply;
    }

    // 3. Increment connection counter
    connectionCounts.set(userId, currentCount + 1);

    // 4. Parse Last-Event-ID for telemetry
    const lastEventIdHeader = req.headers["last-event-id"];
    let seq = 0; // Per-connection monotonic counter

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

    // 5. Set SSE headers
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
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

    // Return reply to prevent Fastify from closing the response
    return reply;
  });
}

/**
 * Resolve user ID for SSE route.
 * Uses the same resolveUserId logic as other routes, with an additional
 * tw_e2e_user cookie fallback in dev_bypass mode for E2E test isolation
 * (EventSource cannot send custom headers).
 */
function resolveSSEUserId(req: FastifyRequest, app: FastifyInstance): string {
  // In oauth mode, parse session cookie (same as resolveUserId)
  if (Env.AUTH_MODE === "oauth") {
    // Delegate to existing auth — the session cookie is sent via withCredentials
    // Import and use the same parseSessionCookie + verifySessionCookie flow
    // This will be wired through the existing resolveUserId function
    // (see registerRoutes.ts integration below)
    throw new Error("oauth resolution delegated to registerRoutes integration");
  }

  // dev_bypass mode: check x-user-id header first (won't be present for EventSource)
  const bypassHeader = req.headers["x-user-id"];
  if (bypassHeader && !Array.isArray(bypassHeader)) {
    return bypassHeader;
  }

  // dev_bypass fallback: read tw_e2e_user cookie for E2E test isolation
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx <= 0) continue;
      if (part.slice(0, eqIdx).trim() === E2E_USER_COOKIE) {
        const value = decodeURIComponent(part.slice(eqIdx + 1).trim());
        if (value) return value;
      }
    }
  }

  // Default user
  return "user-1";
}
```

**Implementation note:** The actual SSE route will integrate with the existing `resolveUserId` function in `registerRoutes.ts` for oauth mode. The `resolveSSEUserId` function above shows the dev_bypass cookie fallback logic that supplements the existing auth flow. The TDD Implementer should wire this through the existing `resolveUserId` by:
1. Either exporting `resolveUserId` from registerRoutes (or extracting to a shared auth utility)
2. Or inlining the cookie parsing + session verification in the SSE route

The preferred approach: **Export `resolveUserId` from registerRoutes.ts** (it's already a standalone function) and call it in the SSE route, then add the `tw_e2e_user` cookie fallback AFTER `resolveUserId` returns the default `"user-1"` in dev_bypass mode.

### 8. SSE Route Registration — `apps/api/src/routes/registerRoutes.ts` (MODIFY)

Changes:
1. Import and call `registerSSERoute(app)` at the end of `registerRoutes()`
2. Export `resolveUserId` so the SSE route can use it (or extract to a shared module)
3. Export `parseSessionCookie` for the SSE route's oauth mode

Minimal diff — just add the import and registration call.

### 9. Synthetic Test Endpoint — `apps/api/src/routes/sseRoute.ts` (in same file)

```ts
// In registerSSERoute():
app.post("/__test/publish-event", async (req) => {
  if (Env.NODE_ENV === "production") {
    throw routeError(404, "not_found", "not found");
  }

  const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  const body = req.body as { type: string; data?: unknown };

  // Validate event type exists
  if (!body.type) {
    throw routeError(400, "invalid_request", "type is required");
  }

  await app.eventBus.publishEvent(userId, body.type, body.data ?? {});
  return { published: true, type: body.type, userId };
});
```

### 10. Frontend: Extract `getApiBaseUrl()` — `apps/web/lib/api.ts` (MODIFY)

Extract the existing `resolveApiBase()` as a named export `getApiBaseUrl()`:

```ts
// Rename internal function and export:
export function getApiBaseUrl(): string {
  // ... same logic as current resolveApiBase()
}

// Keep backward compat:
export const API_BASE = getApiBaseUrl();
```

### 11. Frontend: `useEventStream` Hook — `apps/web/hooks/useEventStream.ts` (NEW)

```ts
import { useEffect, useRef, useCallback } from "react";
import { getApiBaseUrl } from "../lib/api";

export interface UseEventStreamOptions {
  /** SSE event type to listen for (e.g., "recompute_complete") */
  eventType: string;
  /** Handler called when a matching event arrives */
  onEvent: (data: unknown) => void;
  /** Called on reconnection with gap info */
  onReconnect?: (gap: { lastReceivedId: number; currentId: number }) => void;
  /** Called on error */
  onError?: (error: Event) => void;
  /** Whether the stream is enabled (default true) */
  enabled?: boolean;
}

const MAX_RETRIES = 5;

export function useEventStream({
  eventType,
  onEvent,
  onReconnect,
  onError,
  enabled = true,
}: UseEventStreamOptions): void {
  const lastEventIdRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);
  const shouldReconnectRef = useRef<boolean>(true);

  // Stable refs for callbacks
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;

    shouldReconnectRef.current = true;
    retryCountRef.current = 0;

    const url = `${getApiBaseUrl()}/events/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener("open", () => {
      const prevId = lastEventIdRef.current;
      if (prevId > 0) {
        // This is a reconnection
        retryCountRef.current = 0;
        // Gap detection happens when we receive the first event with a new ID
      }
      retryCountRef.current = 0;
    });

    eventSource.addEventListener(eventType, (event: MessageEvent) => {
      const messageEvent = event as MessageEvent;
      const currentId = parseInt(messageEvent.lastEventId, 10);

      // Gap detection on reconnect
      if (lastEventIdRef.current > 0 && currentId === 1) {
        onReconnectRef.current?.({
          lastReceivedId: lastEventIdRef.current,
          currentId,
        });
      }

      if (!isNaN(currentId)) {
        lastEventIdRef.current = currentId;
      }

      try {
        const data = JSON.parse(messageEvent.data);
        onEventRef.current(data);
      } catch {
        onEventRef.current(messageEvent.data);
      }
    });

    // Listen for heartbeat to track IDs
    eventSource.addEventListener("heartbeat", (event: MessageEvent) => {
      const messageEvent = event as MessageEvent;
      const currentId = parseInt(messageEvent.lastEventId, 10);

      // Gap detection on reconnect (first heartbeat after reconnect)
      if (lastEventIdRef.current > 0 && currentId === 1) {
        onReconnectRef.current?.({
          lastReceivedId: lastEventIdRef.current,
          currentId,
        });
      }

      if (!isNaN(currentId)) {
        lastEventIdRef.current = currentId;
      }
    });

    // Handle connection_limit_exceeded error event
    eventSource.addEventListener("error", (event: MessageEvent) => {
      // Named "error" event from server (SSE event type, not EventSource error)
      const messageEvent = event as MessageEvent;
      if (messageEvent.data) {
        try {
          const errorData = JSON.parse(messageEvent.data) as { code?: string };
          if (errorData.code === "connection_limit_exceeded") {
            shouldReconnectRef.current = false;
            eventSource.close();
            return;
          }
        } catch {
          // Not JSON — fall through
        }
      }
    });

    // EventSource built-in error (network, etc.)
    eventSource.onerror = (event) => {
      onErrorRef.current?.(event);
      retryCountRef.current++;

      if (retryCountRef.current >= MAX_RETRIES || !shouldReconnectRef.current) {
        eventSource.close();
      }
      // Otherwise, EventSource auto-reconnects
    };

    return () => {
      shouldReconnectRef.current = false;
      eventSource.close();
    };
  }, [eventType, enabled]);
}
```

---

## Task Assignments

### TDD Implementer Tasks (Implementation Order)

**Phase 1 — Core Infrastructure (files to create/modify):**

1. **Event type registry** — Create `libs/shared-types/src/events.ts`, update `libs/shared-types/src/index.ts`
2. **EventBus types** — Create `apps/api/src/events/types.ts`
3. **InMemoryEventBus** — Create `apps/api/src/events/memory.ts`
4. **RedisEventBus** — Create `apps/api/src/events/redis.ts`
5. **EventBus factory** — Create `apps/api/src/events/index.ts`
6. **App lifecycle wiring** — Modify `apps/api/src/app.ts` (add eventBus to AppInstance, BuildAppOptions, buildApp, onClose hook)
7. **SSE route + synthetic endpoint** — Create `apps/api/src/routes/sseRoute.ts`, modify `apps/api/src/routes/registerRoutes.ts` (import + register, export resolveUserId)
8. **Frontend getApiBaseUrl** — Modify `apps/web/lib/api.ts` (export getApiBaseUrl)
9. **useEventStream hook** — Create `apps/web/hooks/useEventStream.ts`

**Write unit/integration tests TDD-style for items 1-7.** Specifically:
- EventBus pub/sub delivery test (InMemoryEventBus)
- SSE wire format test (id, event, data fields)
- Connection limit test (6th gets error event)
- Heartbeat delivery test
- Synthetic endpoint round-trip test

### Senior QA Tasks

**Phase 1 — Test Plan (no file writes):**
Review the spec and design, identify test cases, design coverage strategy.

**Phase 2 — Test Scripts:**

| Test Scenario | Suite | File |
|--------------|-------|------|
| EventBus pub/sub delivery | Integration (memory) | `apps/api/test/integration/sse.integration.test.ts` |
| Connection limit (6th rejected with error event) | Integration (memory) | same file |
| SSE wire format (id, event, data) | Integration (memory) | same file |
| Heartbeat delivery | Integration (memory) | same file |
| Last-Event-ID gap telemetry logging | Integration (memory) | same file |
| Synthetic endpoint → event delivery | Integration (memory) | same file |
| RedisEventBus pub/sub round-trip | Integration (postgres) | same file (conditional describe block) |
| Synthetic endpoint → useEventStream receives event | E2E bypass | `apps/web/tests/e2e/specs/sse-events.spec.ts` |
| SSE with cookie auth (EventSource + withCredentials) | E2E oauth | `apps/web/tests/e2e/specs-oauth/sse-auth.spec.ts` |

---

## Files In-Scope

### New Files
- `libs/shared-types/src/events.ts`
- `apps/api/src/events/types.ts`
- `apps/api/src/events/memory.ts`
- `apps/api/src/events/redis.ts`
- `apps/api/src/events/index.ts`
- `apps/api/src/routes/sseRoute.ts`
- `apps/web/hooks/useEventStream.ts`
- `apps/api/test/integration/sse.integration.test.ts`
- `apps/web/tests/e2e/specs/sse-events.spec.ts`
- `apps/web/tests/e2e/specs-oauth/sse-auth.spec.ts`

### Modified Files
- `apps/api/src/app.ts` — AppInstance type, buildApp wiring, onClose hook
- `apps/api/src/routes/registerRoutes.ts` — import + register SSE route, export resolveUserId
- `apps/web/lib/api.ts` — export getApiBaseUrl
- `libs/shared-types/src/index.ts` — re-export events

## Files NOT In-Scope (Do NOT Modify)

- `apps/api/src/persistence/*.ts` — no changes to persistence layer
- `apps/api/src/auth/googleOAuth.ts` — no auth code changes
- `apps/api/src/server.ts` — no server startup changes (SIGTERM handler is out of scope for KZO-113)
- `apps/api/vitest.config.ts` — per rule, never modify this
- `apps/web/src/**` — no UI component changes (hook is in `hooks/`, not `src/`)
- `.github/workflows/ci.yml` — no CI changes in this ticket
- Any file in `apps/api/src/services/` — services are KZO-114 territory
- Any file in `apps/api/src/persistence/` — EventBus is a parallel abstraction, not nested in persistence

---

## Acceptance Criteria → Test Mapping

| Acceptance Criterion | Test Type | Test Scenario |
|---------------------|-----------|---------------|
| EventBus pub/sub delivers events to correct user | Integration | Publish to user-A, verify user-A handler fires, user-B handler does not |
| InMemoryEventBus works without Redis | Integration | buildApp({ persistenceBackend: "memory" }) + publish + subscribe |
| RedisEventBus round-trips through Redis | Integration | buildApp({ persistenceBackend: "postgres" }) + publish + subscribe |
| SSE route returns correct Content-Type + headers | Integration | GET /events/stream → check response headers |
| Events include id:, event:, data: fields | Integration | Publish event, read raw SSE frame, parse fields |
| Per-connection monotonic ID counter | Integration | Receive 3 events, verify IDs are 1, 2, 3 |
| Heartbeat delivered every interval | Integration | Connect, wait, verify heartbeat event received |
| Connection limit: 6th gets error event | Integration | Open 5 connections, 6th receives event: error with connection_limit_exceeded |
| Connection limit: error event format is 200 + SSE | Integration | 6th connection status is 200, first event is error type |
| Last-Event-ID logged on reconnect | Integration | Send Last-Event-ID header, verify log output |
| Synthetic endpoint publishes event | Integration | POST /__test/publish-event → subscriber receives event |
| Synthetic endpoint blocked in production | Integration | Set NODE_ENV=production, POST → 404 |
| E2E: synthetic endpoint → hook receives event | E2E bypass | Playwright: trigger publish, verify UI update |
| E2E: SSE works with session cookie auth | E2E oauth | Playwright: authenticate, connect SSE, verify event delivery |
| useEventStream stops reconnecting on connection_limit | E2E bypass | Open many tabs, verify error handling |
| Graceful shutdown closes SSE connections | Integration | app.close() while connection open → connection closes |
| EventBus close() cleans up resources | Integration | app.close() → EventBus handlers cleared |

---

## Key Design Decisions (from debates)

1. **Connection limit response:** 200 + `event: error` with `{"code":"connection_limit_exceeded"}` — NOT raw 429. Prevents EventSource infinite reconnect.
2. **Event IDs:** Per-connection monotonic integers. Parse `Last-Event-ID` on reconnect, log gap telemetry, do NOT replay.
3. **Heartbeats carry `id:` fields** to keep `Last-Event-ID` current during idle periods.
4. **dev_bypass SSE auth:** Fall back to `tw_e2e_user` cookie from `req.headers.cookie` since EventSource cannot send custom headers.
5. **No event buffer/replay in phase 1.** Client handles gaps via state refetch.
6. **RedisEventBus owns 2 connections** (publisher + subscriber). Subscriber MUST have error handler.

---

## Implementation Notes for TDD Implementer

1. **Fastify SSE streaming:** Use `reply.raw.writeHead()` + `reply.raw.write()`. Do NOT use `reply.send()` — it closes the response. Return `reply` from the route handler to prevent Fastify from auto-closing.
2. **Connection cleanup:** `req.raw.on("close", ...)` fires on both clean close (client calls `eventSource.close()`) and dirty close (TCP reset/timeout). Both paths must: unsubscribe from EventBus, clear heartbeat interval, decrement connection counter.
3. **Fastify onSend hook:** The existing security headers hook at `app.ts:118-126` fires once on the initial 200 response. This is fine for SSE — headers are set on the response start and don't change.
4. **Rate limiting:** The `onRequest` rate limit hook at `app.ts:96-116` only applies to mutation methods (POST, PATCH, PUT, DELETE). `GET /events/stream` bypasses it. `POST /__test/publish-event` IS rate-limited — acceptable for test-only endpoint.
5. **resolveUserId export:** The function at `registerRoutes.ts:183` is currently file-scoped. Export it (and `parseSessionCookie` if needed) so the SSE route can reuse the auth flow. Alternatively, move both to a shared `apps/api/src/auth/resolveUser.ts` module.
6. **EventBus init:** `InMemoryEventBus` has no async init (EventEmitter is synchronous). `RedisEventBus` needs `init()` to connect. The factory or `buildApp` should handle this asymmetry — either check for `init` method or always call it (InMemory's can be a no-op).

## Implementation Notes for Senior QA

1. **Integration tests with memory backend:** Use `buildApp({ persistenceBackend: "memory" })`. The EventBus is automatically `InMemoryEventBus`. Use `app.inject()` for HTTP-level testing of the SSE route.
2. **SSE response parsing in tests:** `app.inject()` returns the full response body. For SSE, you may need to use a raw HTTP client or `app.inject()` with streaming support. Alternatively, test EventBus pub/sub separately (unit-level) and the SSE wire format via `app.inject()` for the connection limit + synthetic endpoint scenarios.
3. **E2E test with EventSource:** Playwright can evaluate `EventSource` in the browser via `page.evaluate()`. Create an EventSource, wait for events, collect them in an array, and return the array.
4. **E2E bypass test user isolation:** The E2E fixture sets a `tw_e2e_user` cookie. The SSE route reads this cookie in dev_bypass mode. EventSource sends cookies with `withCredentials: true`. User isolation works without custom headers.
5. **Redis integration test:** The `test:integration:full:host` suite has access to a real Redis instance. Gate the Redis EventBus test behind a `describe.skipIf(!process.env.REDIS_URL)` or similar conditional.

---

## Open Items (decided during implementation)

1. **Hook retry budget:** 5 retries with exponential backoff, then stop. Implemented in `useEventStream`.
2. **SSE request logging:** Accept Fastify's default behavior for now. Long-lived connections will show long durations in access logs. Custom SSE lifecycle logging (connect/disconnect/event-count) is a nice-to-have for KZO-114+.
3. **Heartbeat/gap interaction:** Heartbeats increment the sequence counter. A reconnect after idle time shows a gap of heartbeat-count. The `onReconnect` callback fires, consumer refetches. Acceptable for phase 1.
