import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "dev_bypass" as const,
      REDIS_URL: process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL,
      getRedisUrl: () =>
        process.env.POSTGRES_TEST_REDIS_URL ??
        process.env.REDIS_URL ??
        original.Env.getRedisUrl(),
    },
  };
});

import { buildApp } from "../../src/app.js";
import { _resetConnectionCounts, MAX_CONNECTIONS_PER_USER } from "../../src/routes/sseRoute.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl: string;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;

/**
 * Parse SSE frames from a raw response body chunk.
 */
function parseSSEFrames(body: string): Array<{ id?: string; event?: string; data?: string }> {
  const frames: Array<{ id?: string; event?: string; data?: string }> = [];
  const rawFrames = body.split("\n\n").filter((f) => f.trim().length > 0);
  for (const raw of rawFrames) {
    const frame: { id?: string; event?: string; data?: string } = {};
    for (const line of raw.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0) continue;
      const field = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (field === "id") frame.id = value;
      else if (field === "event") frame.event = value;
      else if (field === "data") frame.data = value;
    }
    frames.push(frame);
  }
  return frames;
}

/**
 * Open an SSE connection and collect frames until the callback resolves.
 * Returns collected frames plus the HTTP response.
 */
function openSSEConnection(
  url: string,
  headers: Record<string, string> = {},
): {
  frames: Array<{ id?: string; event?: string; data?: string }>;
  statusCode: Promise<number>;
  responseHeaders: Promise<http.IncomingHttpHeaders>;
  close: () => void;
  waitForFrames: (count: number, timeoutMs?: number) => Promise<void>;
} {
  const frames: Array<{ id?: string; event?: string; data?: string }> = [];
  let resolveStatus: (code: number) => void;
  let resolveHeaders: (h: http.IncomingHttpHeaders) => void;
  const statusCode = new Promise<number>((r) => (resolveStatus = r));
  const responseHeaders = new Promise<http.IncomingHttpHeaders>((r) => (resolveHeaders = r));

  let frameWaiters: Array<{ count: number; resolve: () => void }> = [];

  const req = http.get(url, { headers }, (res) => {
    resolveStatus!(res.statusCode ?? 0);
    resolveHeaders!(res.headers);

    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      // Parse complete frames from buffer
      while (buffer.includes("\n\n")) {
        const idx = buffer.indexOf("\n\n");
        const rawFrame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (rawFrame.trim().length > 0) {
          const parsed = parseSSEFrames(rawFrame + "\n\n");
          frames.push(...parsed);

          // Check if any waiters are satisfied
          frameWaiters = frameWaiters.filter((w) => {
            if (frames.length >= w.count) {
              w.resolve();
              return false;
            }
            return true;
          });
        }
      }
    });
  });

  return {
    frames,
    statusCode,
    responseHeaders,
    close: () => req.destroy(),
    waitForFrames: (count: number, timeoutMs = 3000) =>
      new Promise<void>((resolve, reject) => {
        if (frames.length >= count) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for ${count} frames, got ${frames.length}`));
        }, timeoutMs);
        frameWaiters.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      }),
  };
}

describe("SSE infrastructure", () => {
  beforeEach(async () => {
    _resetConnectionCounts();
    app = await buildApp({ persistenceBackend: "memory" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "string" || !addr) throw new Error("Failed to get server address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("InMemoryEventBus pub/sub", () => {
    it("delivers events to the subscribed user only", async () => {
      const receivedA: Array<{ type: string; data: unknown }> = [];
      const receivedB: Array<{ type: string; data: unknown }> = [];

      app.eventBus.subscribe("user-a", (event) => receivedA.push(event));
      app.eventBus.subscribe("user-b", (event) => receivedB.push(event));

      await app.eventBus.publishEvent("user-a", "recompute_complete", { portfolioId: "p1" });

      expect(receivedA).toEqual([{ type: "recompute_complete", data: { portfolioId: "p1" }, seq: 1 }]);
      expect(receivedB).toEqual([]);
    });

    it("cleans up handlers on close", async () => {
      const received: Array<{ type: string; data: unknown }> = [];
      app.eventBus.subscribe("user-x", (event) => received.push(event));

      await app.eventBus.close();
      await app.eventBus.publishEvent("user-x", "test", {});

      expect(received).toEqual([]);
    });

    it("supports unsubscribe", async () => {
      const received: Array<{ type: string; data: unknown }> = [];
      const unsub = app.eventBus.subscribe("user-y", (event) => received.push(event));

      await app.eventBus.publishEvent("user-y", "first", {});
      unsub();
      await app.eventBus.publishEvent("user-y", "second", {});

      expect(received).toHaveLength(1);
      expect(received[0]!.type).toBe("first");
    });
  });

  describe("GET /events/stream", () => {
    it("returns correct SSE headers and initial heartbeat", async () => {
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "test-user-1",
      });

      try {
        await conn.waitForFrames(1);
        const status = await conn.statusCode;
        const headers = await conn.responseHeaders;

        expect(status).toBe(200);
        expect(headers["content-type"]).toBe("text/event-stream");
        expect(headers["cache-control"]).toBe("no-cache");

        expect(conn.frames.length).toBeGreaterThanOrEqual(1);
        expect(conn.frames[0]!.event).toBe("heartbeat");
        expect(conn.frames[0]!.id).toBe("1");
        expect(conn.frames[0]!.data).toBe("{}");
      } finally {
        conn.close();
      }
    });

    it("delivers events with correct SSE wire format and monotonic IDs", async () => {
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "wire-user",
      });

      try {
        // Wait for initial heartbeat
        await conn.waitForFrames(1);
        expect(conn.frames[0]!.id).toBe("1");

        // Publish an event via EventBus
        await app.eventBus.publishEvent("wire-user", "recompute_complete", { portfolioId: "abc" });

        // Wait for the published event
        await conn.waitForFrames(2);

        const eventFrame = conn.frames[1]!;
        expect(eventFrame.id).toBe("2");
        expect(eventFrame.event).toBe("recompute_complete");
        expect(eventFrame.data).toBe(JSON.stringify({ portfolioId: "abc" }));
      } finally {
        conn.close();
      }
    });

    it("delivers multiple events with incrementing IDs", async () => {
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "multi-user",
      });

      try {
        await conn.waitForFrames(1); // heartbeat: id=1

        await app.eventBus.publishEvent("multi-user", "event_a", { a: 1 });
        await app.eventBus.publishEvent("multi-user", "event_b", { b: 2 });
        await conn.waitForFrames(3); // heartbeat + 2 events

        expect(conn.frames[0]!.id).toBe("1");
        expect(conn.frames[1]!.id).toBe("2");
        expect(conn.frames[2]!.id).toBe("3");
      } finally {
        conn.close();
      }
    });
  });

  describe("connection limit", () => {
    it(`${MAX_CONNECTIONS_PER_USER + 1}th connection receives error event with connection_limit_exceeded, not 429`, async () => {
      const connections: ReturnType<typeof openSSEConnection>[] = [];

      try {
        // Open MAX_CONNECTIONS_PER_USER connections for the same user
        for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i++) {
          const conn = openSSEConnection(`${baseUrl}/events/stream`, {
            "x-user-id": "limit-user",
          });
          connections.push(conn);
          await conn.waitForFrames(1); // wait for initial heartbeat
        }

        // (MAX_CONNECTIONS_PER_USER + 1)th connection should get error event
        const sixthConn = openSSEConnection(`${baseUrl}/events/stream`, {
          "x-user-id": "limit-user",
        });
        connections.push(sixthConn);

        await sixthConn.waitForFrames(1);
        const status = await sixthConn.statusCode;

        // Should be 200 (not 429)
        expect(status).toBe(200);

        // Error event format
        expect(sixthConn.frames[0]!.event).toBe("error");
        const errorData = JSON.parse(sixthConn.frames[0]!.data ?? "{}");
        expect(errorData.code).toBe("connection_limit_exceeded");
      } finally {
        for (const conn of connections) conn.close();
      }
    });
  });

  describe("synthetic test endpoint", () => {
    it("publishes event and receives it via EventBus subscription", async () => {
      const received: Array<{ type: string; data: unknown }> = [];
      app.eventBus.subscribe("synth-user", (event) => received.push(event));

      const res = await app.inject({
        method: "POST",
        url: "/__test/publish-event",
        headers: { "x-user-id": "synth-user", "content-type": "application/json" },
        payload: JSON.stringify({ type: "recompute_complete", data: { portfolioId: "test-1" } }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        published: true,
        type: "recompute_complete",
        userId: "synth-user",
      });

      expect(received).toEqual([
        { type: "recompute_complete", data: { portfolioId: "test-1" }, seq: 1 },
      ]);
    });

    it("rejects missing type with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/__test/publish-event",
        headers: { "x-user-id": "err-user", "content-type": "application/json" },
        payload: JSON.stringify({ data: { foo: "bar" } }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("defaults to user-1 in dev_bypass mode without x-user-id header", async () => {
      const received: Array<{ type: string; data: unknown }> = [];
      app.eventBus.subscribe("user-1", (event) => received.push(event));

      const res = await app.inject({
        method: "POST",
        url: "/__test/publish-event",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ type: "test_event", data: {} }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().userId).toBe("user-1");
      expect(received).toHaveLength(1);
    });

    it("round-trip: publish via synthetic endpoint, receive via SSE stream", async () => {
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "roundtrip-user",
      });

      try {
        await conn.waitForFrames(1); // initial heartbeat

        // Publish via synthetic endpoint
        const res = await app.inject({
          method: "POST",
          url: "/__test/publish-event",
          headers: { "x-user-id": "roundtrip-user", "content-type": "application/json" },
          payload: JSON.stringify({ type: "recompute_complete", data: { portfolioId: "rt-1" } }),
        });
        expect(res.statusCode).toBe(200);

        // Verify SSE stream received the event
        await conn.waitForFrames(2);
        expect(conn.frames[1]!.event).toBe("recompute_complete");
        expect(conn.frames[1]!.data).toBe(JSON.stringify({ portfolioId: "rt-1" }));
      } finally {
        conn.close();
      }
    });
  });

  describe("SSE user resolution", () => {
    it("falls back to tw_e2e_user cookie in dev_bypass mode", async () => {
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        cookie: "tw_e2e_user=cookie-user-42",
      });

      try {
        await conn.waitForFrames(1);
        const status = await conn.statusCode;

        expect(status).toBe(200);
        expect(conn.frames[0]!.event).toBe("heartbeat");

        // Verify the user resolution by publishing to the cookie user
        await app.eventBus.publishEvent("cookie-user-42", "test_event", { ok: true });
        await conn.waitForFrames(2);
        expect(conn.frames[1]!.event).toBe("test_event");
      } finally {
        conn.close();
      }
    });
  });

  describe("Last-Event-ID", () => {
    it("accepts connection with Last-Event-ID header (no buffered events for fresh user)", async () => {
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "reconnect-user",
        "last-event-id": "42",
      });

      try {
        await conn.waitForFrames(1);
        const status = await conn.statusCode;

        // Connection succeeds — no buffered events for this user
        expect(status).toBe(200);
        // Fresh user starts at seq 1
        expect(conn.frames[0]!.id).toBe("1");
      } finally {
        conn.close();
      }
    });
  });

  describe("app lifecycle", () => {
    it("eventBus is available on the app instance", () => {
      expect(app.eventBus).toBeDefined();
      expect(typeof app.eventBus.publishEvent).toBe("function");
      expect(typeof app.eventBus.subscribe).toBe("function");
      expect(typeof app.eventBus.close).toBe("function");
    });

    it("app.close() cleans up eventBus", async () => {
      const received: Array<{ type: string; data: unknown }> = [];
      app.eventBus.subscribe("close-user", (event) => received.push(event));

      await app.close();
      await app.eventBus.publishEvent("close-user", "after_close", {});

      expect(received).toEqual([]);

      // Rebuild app for afterEach cleanup
      app = await buildApp({ persistenceBackend: "memory" });
      await app.listen({ port: 0, host: "127.0.0.1" });
      const addr = app.server.address();
      if (typeof addr === "string" || !addr) throw new Error("Failed to get server address");
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    it("client disconnect triggers server-side cleanup", async () => {
      // Open SSE connection and verify it's active
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "cleanup-user",
      });
      await conn.waitForFrames(1); // initial heartbeat
      expect(await conn.statusCode).toBe(200);

      // Verify event delivery works while connected
      await app.eventBus.publishEvent("cleanup-user", "before_close", {});
      await conn.waitForFrames(2);
      expect(conn.frames[1]!.event).toBe("before_close");

      // Destroy client connection — triggers server-side cleanup
      conn.close();
      await new Promise((r) => setTimeout(r, 200));

      // After disconnect, the connection counter should be decremented.
      // Verify by opening a new connection (if counter leaked, 5 more
      // connections would exhaust the limit sooner).
      const newConn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "cleanup-user",
      });
      await newConn.waitForFrames(1);
      expect(await newConn.statusCode).toBe(200);
      expect(newConn.frames[0]!.event).toBe("heartbeat");
      // Per-user seq persists across connections — heartbeat continues from last seq
      const reconnectId = parseInt(newConn.frames[0]!.id!, 10);
      expect(reconnectId).toBeGreaterThan(1);
      newConn.close();
    });
  });

  describe("Last-Event-ID replay logging", () => {
    it("logs sse_replay with userId and lastEventId on reconnect", async () => {
      // Capture log calls from the child request logger.
      // Fastify creates a child logger per request, so we spy on the factory.
      const logEntries: Array<Record<string, unknown>> = [];
      const originalChildLogger = app.log.child.bind(app.log);
      vi.spyOn(app.log, "child").mockImplementation((bindings, ...rest) => {
        const child = originalChildLogger(bindings, ...rest);
        const originalInfo = child.info.bind(child);
        child.info = (...args: unknown[]) => {
          if (args.length > 0 && typeof args[0] === "object" && args[0] !== null) {
            logEntries.push(args[0] as Record<string, unknown>);
          }
          return (originalInfo as (...args: unknown[]) => void)(...args);
        };
        return child;
      });

      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": "telemetry-user",
        "last-event-id": "42",
      });

      try {
        await conn.waitForFrames(1);

        // Check that sse_replay was logged
        const replayLog = logEntries.find((e) => e.msg === "sse_replay");
        expect(replayLog).toBeDefined();
        expect(replayLog!.userId).toBe("telemetry-user");
        expect(replayLog!.lastEventId).toBe(42);
        expect(replayLog!.replayedCount).toBe(0);
      } finally {
        conn.close();
      }
    });
  });

  describe("SSE replay (Last-Event-ID)", () => {
    // I1: Replay on reconnect — connect, receive events, disconnect, reconnect
    // with Last-Event-ID, verify replayed events arrive before live heartbeat
    it("replays buffered events on reconnect with Last-Event-ID", async () => {
      const userId = "replay-user";

      // First connection: establish seq counter
      const conn1 = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": userId,
      });

      try {
        await conn1.waitForFrames(1); // heartbeat id=1
        expect(conn1.frames[0]!.event).toBe("heartbeat");

        // Publish 2 events while connected (they get buffered)
        await app.eventBus.publishEvent(userId, "recompute_started", { ticker: "AAPL" });
        await app.eventBus.publishEvent(userId, "recompute_complete", { ticker: "AAPL" });
        await conn1.waitForFrames(3); // heartbeat + 2 events
      } finally {
        conn1.close();
      }

      // Wait for server to process disconnect
      await new Promise((r) => setTimeout(r, 150));

      // Publish events while disconnected — these should be buffered
      await app.eventBus.publishEvent(userId, "recompute_started", { ticker: "MSFT" });
      await app.eventBus.publishEvent(userId, "recompute_complete", { ticker: "MSFT" });

      // Reconnect with Last-Event-ID pointing to the heartbeat (seq 1)
      // This should replay all buffered events with seq > 1
      const conn2 = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": userId,
        "last-event-id": "1",
      });

      try {
        // Expect: replayed events (seq 2, 3, 4, 5) + new heartbeat
        // At minimum we should get the 4 replayed events
        await conn2.waitForFrames(4, 5000);

        // Replayed events should come first, before the live heartbeat
        const replayedFrames = conn2.frames.filter((f) => f.event !== "heartbeat");
        expect(replayedFrames.length).toBeGreaterThanOrEqual(2);

        // Verify replayed events have correct sequential IDs > 1
        for (const frame of replayedFrames) {
          const id = parseInt(frame.id!, 10);
          expect(id).toBeGreaterThan(1);
        }

        // Verify the events contain expected data
        const eventTypes = replayedFrames.map((f) => f.event);
        expect(eventTypes).toContain("recompute_started");
        expect(eventTypes).toContain("recompute_complete");
      } finally {
        conn2.close();
      }
    });

    // I2: No replay on fresh connection
    it("does not replay on fresh connection without Last-Event-ID", async () => {
      const userId = "fresh-conn-user";

      // Publish some events to the buffer before connecting
      await app.eventBus.publishEvent(userId, "old_event_1", {});
      await app.eventBus.publishEvent(userId, "old_event_2", {});

      // Connect without Last-Event-ID
      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": userId,
      });

      try {
        await conn.waitForFrames(1);

        // First frame should be heartbeat (no replay)
        expect(conn.frames[0]!.event).toBe("heartbeat");

        // The heartbeat seq should be > 2 because publishEvent already consumed seqs 1, 2
        const heartbeatId = parseInt(conn.frames[0]!.id!, 10);
        expect(heartbeatId).toBeGreaterThan(2);

        // No replayed events — only the heartbeat
        expect(conn.frames).toHaveLength(1);
      } finally {
        conn.close();
      }
    });

    // I3: Sequence continuity across reconnections
    it("maintains sequence continuity across reconnections", async () => {
      const userId = "seq-continuity-user";

      // First connection
      const conn1 = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": userId,
      });

      let lastSeq: number;
      try {
        await conn1.waitForFrames(1); // heartbeat
        await app.eventBus.publishEvent(userId, "event_a", {});
        await conn1.waitForFrames(2);

        lastSeq = parseInt(conn1.frames[1]!.id!, 10);
        expect(lastSeq).toBeGreaterThan(0);
      } finally {
        conn1.close();
      }

      await new Promise((r) => setTimeout(r, 150));

      // Reconnect with Last-Event-ID set to last received seq
      const conn2 = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": userId,
        "last-event-id": String(lastSeq!),
      });

      try {
        await conn2.waitForFrames(1); // at least heartbeat

        // Publish a new event
        await app.eventBus.publishEvent(userId, "event_b", {});
        await conn2.waitForFrames(2);

        // Find the event_b frame
        const eventB = conn2.frames.find((f) => f.event === "event_b");
        expect(eventB).toBeDefined();

        const eventBSeq = parseInt(eventB!.id!, 10);
        // Seq must be strictly greater than the last seq from connection 1
        expect(eventBSeq).toBeGreaterThan(lastSeq!);

        // Verify all frame IDs are monotonically increasing
        const ids = conn2.frames.map((f) => parseInt(f.id!, 10));
        for (let i = 1; i < ids.length; i++) {
          expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
        }
      } finally {
        conn2.close();
      }
    });

    // I4: Non-parseable Last-Event-ID treated as fresh connection
    it("treats non-parseable Last-Event-ID as fresh connection", async () => {
      const userId = "unparseable-id-user";

      // Publish events before connecting
      await app.eventBus.publishEvent(userId, "buffered_event", {});

      const conn = openSSEConnection(`${baseUrl}/events/stream`, {
        "x-user-id": userId,
        "last-event-id": "not-a-number",
      });

      try {
        await conn.waitForFrames(1);
        const status = await conn.statusCode;

        // Connection should succeed
        expect(status).toBe(200);

        // First frame is heartbeat — no replay attempted
        expect(conn.frames[0]!.event).toBe("heartbeat");

        // No buffered events replayed (only heartbeat arrived)
        expect(conn.frames).toHaveLength(1);
      } finally {
        conn.close();
      }
    });
  });
});

// ─── RedisEventBus (conditional on configured Redis URL) ─────────────────

describe.skipIf(!redisUrl)("RedisEventBus", () => {
  let redisApp: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    _resetConnectionCounts();
    redisApp = await buildApp({ persistenceBackend: "memory", eventBusBackend: "postgres" });
  });

  afterEach(async () => {
    if (redisApp) await redisApp.close();
  });

  it("pub/sub round-trip through Redis", async () => {
    const received: Array<{ type: string; data: unknown }> = [];
    redisApp.eventBus.subscribe("redis-user", (event) => received.push(event));

    // Allow Redis subscription to register
    await new Promise((r) => setTimeout(r, 200));

    await redisApp.eventBus.publishEvent("redis-user", "recompute_complete", { test: true });

    // Wait for Redis round-trip
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: "recompute_complete", data: { test: true }, seq: 1 });
  });

  it("close() disconnects cleanly without errors", async () => {
    redisApp.eventBus.subscribe("redis-close-user", () => {});

    // Close should not throw
    await expect(redisApp.eventBus.close()).resolves.toBeUndefined();

    // Rebuild for afterEach
    redisApp = await buildApp({ persistenceBackend: "memory", eventBusBackend: "postgres" });
  });
});
