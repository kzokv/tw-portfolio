import { Env } from "@tw-portfolio/config";
import { MemoryPersistence } from "./memory.js";
import { PostgresPersistence } from "./postgres.js";
import type { Persistence } from "./types.js";

export function createPersistence(backend: "postgres" | "memory" = Env.PERSISTENCE_BACKEND): Persistence {
  if (backend === "memory") {
    return new MemoryPersistence();
  }

  return new PostgresPersistence({
    databaseUrl: Env.getDatabaseUrl(),
    redisUrl: Env.getRedisUrl(),
  });
}
