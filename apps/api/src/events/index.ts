import { Env } from "@tw-portfolio/config";
import { InMemoryEventBus } from "./memory.js";
import { RedisEventBus } from "./redis.js";
import { BufferedEventBus } from "./buffered.js";
import type { EventBus } from "./types.js";

export type { EventBus } from "./types.js";
export { BufferedEventBus } from "./buffered.js";
export type { BufferedEvent } from "./buffered.js";

export function createEventBus(backend: "postgres" | "memory" = Env.PERSISTENCE_BACKEND): BufferedEventBus {
  const inner: EventBus =
    backend === "memory" ? new InMemoryEventBus() : new RedisEventBus({ redisUrl: Env.getRedisUrl() });
  return new BufferedEventBus(inner);
}
