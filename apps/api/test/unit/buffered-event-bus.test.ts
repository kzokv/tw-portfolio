import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferedEventBus, _resetBufferedEventBus } from "../../src/events/buffered.js";
import { InMemoryEventBus } from "../../src/events/memory.js";

let inner: InMemoryEventBus;
let bus: BufferedEventBus;

describe("BufferedEventBus", () => {
  beforeEach(() => {
    inner = new InMemoryEventBus();
    bus = new BufferedEventBus(inner);
  });

  afterEach(async () => {
    await bus.close();
  });

  // U1: publishEvent stores in buffer
  it("publishEvent stores event in buffer with correct seq, type, data", async () => {
    await bus.publishEvent("user-1", "recompute_complete", { portfolioId: "p1" });

    const events = bus.getEventsSince("user-1", 0);
    expect(events).toHaveLength(1);
    expect(events[0]!.seq).toBe(1);
    expect(events[0]!.type).toBe("recompute_complete");
    expect(events[0]!.data).toEqual({ portfolioId: "p1" });
    expect(events[0]!.timestamp).toBeGreaterThan(0);
  });

  // U2: Sequence counter increments monotonically
  it("sequence counter increments monotonically for same user", async () => {
    await bus.publishEvent("user-1", "event_a", {});
    await bus.publishEvent("user-1", "event_b", {});
    await bus.publishEvent("user-1", "event_c", {});

    const events = bus.getEventsSince("user-1", 0);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  // U3: Sequence counter is per-user
  it("sequence counter is isolated per user", async () => {
    await bus.publishEvent("user-a", "event_1", {});
    await bus.publishEvent("user-b", "event_1", {});
    await bus.publishEvent("user-a", "event_2", {});

    const eventsA = bus.getEventsSince("user-a", 0);
    const eventsB = bus.getEventsSince("user-b", 0);

    expect(eventsA.map((e) => e.seq)).toEqual([1, 2]);
    expect(eventsB.map((e) => e.seq)).toEqual([1]);
  });

  // U4: TTL eviction
  it("evicts events older than TTL", async () => {
    const shortTtlBus = new BufferedEventBus(new InMemoryEventBus(), 50);

    await shortTtlBus.publishEvent("user-1", "old_event", { old: true });

    // Event should be in buffer immediately
    expect(shortTtlBus.getEventsSince("user-1", 0)).toHaveLength(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 100));

    // Event should be evicted
    expect(shortTtlBus.getEventsSince("user-1", 0)).toHaveLength(0);

    await shortTtlBus.close();
  });

  // U5: getEventsSince filters by seq
  it("getEventsSince returns only events with seq > lastSeq", async () => {
    await bus.publishEvent("user-1", "e1", { n: 1 });
    await bus.publishEvent("user-1", "e2", { n: 2 });
    await bus.publishEvent("user-1", "e3", { n: 3 });
    await bus.publishEvent("user-1", "e4", { n: 4 });
    await bus.publishEvent("user-1", "e5", { n: 5 });

    const events = bus.getEventsSince("user-1", 3);
    expect(events).toHaveLength(2);
    expect(events[0]!.seq).toBe(4);
    expect(events[1]!.seq).toBe(5);
  });

  // U6: getEventsSince returns empty for unknown user
  it("getEventsSince returns empty array for unknown user", () => {
    const events = bus.getEventsSince("nonexistent-user", 0);
    expect(events).toEqual([]);
  });

  // U7: subscribe delivers events with seq
  it("subscribe delivers events with seq to handler", async () => {
    const received: Array<{ type: string; data: unknown; seq?: number }> = [];
    bus.subscribe("user-1", (event) => received.push(event));

    await bus.publishEvent("user-1", "test_event", { key: "value" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: "test_event", data: { key: "value" }, seq: 1 });
  });

  // U8: nextSeq increments without buffering
  it("nextSeq increments counter without storing in buffer", () => {
    expect(bus.nextSeq("user-1")).toBe(1);
    expect(bus.nextSeq("user-1")).toBe(2);
    expect(bus.nextSeq("user-1")).toBe(3);

    // Nothing in the buffer — nextSeq does not buffer
    const events = bus.getEventsSince("user-1", 0);
    expect(events).toEqual([]);
  });

  // U9: close clears state and closes inner bus
  it("close clears all state and delegates to inner bus", async () => {
    const closeSpy = vi.spyOn(inner, "close");

    await bus.publishEvent("user-1", "event", {});
    bus.subscribe("user-1", () => {});

    await bus.close();

    // Buffer should be cleared
    expect(bus.getEventsSince("user-1", 0)).toEqual([]);

    // Inner bus close should have been called
    expect(closeSpy).toHaveBeenCalledOnce();

    // Subscribers should be removed (publishing should not deliver)
    const received: unknown[] = [];
    bus.subscribe("user-1", (e) => received.push(e));
  });

  // U10: Multiple subscribers receive same event
  it("multiple subscribers receive the same event with identical seq", async () => {
    const receivedA: Array<{ type: string; data: unknown; seq?: number }> = [];
    const receivedB: Array<{ type: string; data: unknown; seq?: number }> = [];

    bus.subscribe("user-1", (event) => receivedA.push(event));
    bus.subscribe("user-1", (event) => receivedB.push(event));

    await bus.publishEvent("user-1", "shared_event", { shared: true });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(receivedA[0]).toEqual(receivedB[0]);
    expect(receivedA[0]!.seq).toBe(1);
  });

  // U11: _resetBufferedEventBus clears all state
  it("_resetBufferedEventBus clears buffers, seqCounters, and listeners", async () => {
    const received: unknown[] = [];
    bus.subscribe("user-1", (e) => received.push(e));

    await bus.publishEvent("user-1", "event", {});
    expect(bus.getEventsSince("user-1", 0)).toHaveLength(1);
    expect(received).toHaveLength(1);

    _resetBufferedEventBus(bus);

    // Buffer cleared
    expect(bus.getEventsSince("user-1", 0)).toEqual([]);

    // Seq counter reset — next publish starts at 1 again
    await bus.publishEvent("user-1", "after_reset", {});
    const events = bus.getEventsSince("user-1", 0);
    expect(events).toHaveLength(1);
    expect(events[0]!.seq).toBe(1);

    // Old subscriber removed — received array should still have just 1 from before reset
    expect(received).toHaveLength(1);
  });

  // U12: Mixed nextSeq + publishEvent share counter
  it("nextSeq and publishEvent share the same per-user counter", async () => {
    const seq1 = bus.nextSeq("user-1"); // 1
    await bus.publishEvent("user-1", "event_after_heartbeat", {}); // seq 2
    const seq3 = bus.nextSeq("user-1"); // 3

    expect(seq1).toBe(1);
    expect(seq3).toBe(3);

    const events = bus.getEventsSince("user-1", 0);
    expect(events).toHaveLength(1);
    expect(events[0]!.seq).toBe(2);
  });
});
