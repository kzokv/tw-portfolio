import { Env } from "@vakwen/config";
import { MemoryPersistence } from "./memory.js";
import { PostgresPersistence } from "./postgres.js";
import type { Persistence } from "./types.js";

interface PersistenceFactoryOptions {
  seedMemoryCatalog?: boolean;
  seedDevBypassUser?: boolean;
  postgresPoolMax?: number;
}

export function createPersistence(
  backend: "postgres" | "memory" = Env.PERSISTENCE_BACKEND,
  options: PersistenceFactoryOptions = {},
): Persistence {
  if (backend === "memory") {
    return new MemoryPersistence({
      seedCatalog: options.seedMemoryCatalog,
      seedDevBypassUser: options.seedDevBypassUser,
    });
  }

  return new PostgresPersistence({
    databaseUrl: Env.getDatabaseUrl(),
    redisUrl: Env.getRedisUrl(),
    poolMax: options.postgresPoolMax,
  });
}
