import { EventEmitter } from "node:events";
import type { EventBus, EventHandler, Unsubscribe } from "./types.js";

export interface BufferedEvent {
  seq: number;
  type: string;
  data: unknown;
  timestamp: number;
}

const DEFAULT_TTL_MS = 60_000;

export class BufferedEventBus implements EventBus {
  private readonly inner: EventBus;
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, BufferedEvent[]>();
  private readonly seqCounters = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(inner: EventBus, ttlMs: number = DEFAULT_TTL_MS) {
    this.inner = inner;
    this.ttlMs = ttlMs;
    this.emitter.setMaxListeners(0);
  }

  /**
   * Increment and return the next sequence number for a user.
   * Public so sseRoute can allocate seq for heartbeats without buffering.
   */
  nextSeq(userId: string): number {
    const current = this.seqCounters.get(userId) ?? 0;
    const next = current + 1;
    this.seqCounters.set(userId, next);
    return next;
  }

  private evictExpired(userId: string): void {
    const buffer = this.buffers.get(userId);
    if (!buffer) return;
    const cutoff = Date.now() - this.ttlMs;
    while (buffer.length > 0 && buffer[0]!.timestamp < cutoff) {
      buffer.shift();
    }
    if (buffer.length === 0) this.buffers.delete(userId);
  }

  async publishEvent(userId: string, type: string, data: unknown): Promise<void> {
    const seq = this.nextSeq(userId);
    const entry: BufferedEvent = { seq, type, data, timestamp: Date.now() };

    let buffer = this.buffers.get(userId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(userId, buffer);
    }
    buffer.push(entry);
    this.evictExpired(userId);

    // Deliver to local subscribers with seq
    this.emitter.emit(`events:${userId}`, { type, data, seq });
  }

  subscribe(userId: string, handler: EventHandler): Unsubscribe {
    const channel = `events:${userId}`;
    this.emitter.on(channel, handler);
    return () => {
      this.emitter.off(channel, handler);
    };
  }

  /**
   * Return buffered events for a user with seq > lastSeq.
   * Used for Last-Event-ID replay on reconnect.
   */
  getEventsSince(userId: string, lastSeq: number): BufferedEvent[] {
    this.evictExpired(userId);
    const buffer = this.buffers.get(userId);
    if (!buffer) return [];
    return buffer.filter((e) => e.seq > lastSeq);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    this.buffers.clear();
    this.seqCounters.clear();
    await this.inner.close();
  }
}

/** Exported for testing — reset buffer and sequence state between tests. */
export function _resetBufferedEventBus(bus: BufferedEventBus): void {
  // Access internals for test cleanup — BufferedEventBus.close() also does this
  // but also closes the inner bus which we may not want in beforeEach
  const internals = bus as unknown as {
    buffers: Map<string, unknown[]>;
    seqCounters: Map<string, number>;
    emitter: EventEmitter;
  };
  internals.buffers.clear();
  internals.seqCounters.clear();
  internals.emitter.removeAllListeners();
}
