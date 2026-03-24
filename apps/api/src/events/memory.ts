import { EventEmitter } from "node:events";
import type { EventBus, EventHandler, Unsubscribe } from "./types.js";

export class InMemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async publishEvent(userId: string, type: string, payload: unknown): Promise<void> {
    this.emitter.emit(`events:${userId}`, { type, data: payload });
  }

  subscribe(userId: string, handler: EventHandler): Unsubscribe {
    const channel = `events:${userId}`;
    this.emitter.on(channel, handler);
    return () => {
      this.emitter.off(channel, handler);
    };
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
