import { createClient, type RedisClientType } from "redis";
import { buildRedisSocketOptions } from "../lib/redisClientOptions.js";
import type { EventBus, EventHandler, Unsubscribe } from "./types.js";

export interface RedisEventBusOptions {
  redisUrl: string;
}

export class RedisEventBus implements EventBus {
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly options: RedisEventBusOptions) {
    this.publisher = createClient({
      url: options.redisUrl,
      socket: buildRedisSocketOptions(),
    });
    this.subscriber = createClient({
      url: options.redisUrl,
      socket: buildRedisSocketOptions(),
    });

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

      void this.subscriber.subscribe(channel, (message) => {
        let parsed: { type: string; data: unknown };
        try {
          parsed = JSON.parse(message) as { type: string; data: unknown };
        } catch (err) {
          console.error("[RedisEventBus] failed to parse message:", err);
          return;
        }
        for (const h of handlerSet) h(parsed);
      });
    }

    return () => {
      const set = this.handlers.get(channel);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        void this.subscriber.unsubscribe(channel).catch((err) => {
          console.error("[RedisEventBus] unsubscribe error:", err);
        });
      }
    };
  }

  async close(): Promise<void> {
    for (const channel of this.handlers.keys()) {
      await this.subscriber.unsubscribe(channel);
    }
    this.handlers.clear();

    if (this.subscriber.isOpen) await this.subscriber.quit();
    if (this.publisher.isOpen) await this.publisher.quit();
  }
}
