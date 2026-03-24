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
