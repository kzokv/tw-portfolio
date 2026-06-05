import { vi } from "vitest";

const timeoutMs = Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS ?? 0);
const redisTimeoutMs = Number(process.env.REDIS_CONNECTION_TIMEOUT_MS ?? timeoutMs);
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";
const retryAttempts = Number(process.env.POSTGRES_CONNECT_RETRY_ATTEMPTS ?? (managedCiStack ? 8 : 4));
const retryDelayMs = Number(process.env.POSTGRES_CONNECT_RETRY_DELAY_MS ?? (managedCiStack ? 500 : 250));
const redisRetryAttempts = Number(process.env.REDIS_RECONNECT_MAX_RETRIES ?? retryAttempts);

function isConnectionTimeout(error: unknown): boolean {
  const message =
    error instanceof Error || (typeof error === "object" && error !== null && "message" in error)
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return (
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ETIMEDOUT") ||
    message.includes("Connection terminated due to connection timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("Connection terminated unexpectedly")
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryConnectionTimeout<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isConnectionTimeout(error) || attempt === retryAttempts) {
        throw error;
      }
      await wait(retryDelayMs * attempt);
    }
  }

  throw lastError;
}

if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
  vi.mock("pg", async (importOriginal) => {
    const original = await importOriginal<typeof import("pg")>();
    const OriginalPool = original.Pool;
    type PoolConfig = ConstructorParameters<typeof OriginalPool>[0];
    type PoolInstance = InstanceType<typeof OriginalPool>;
    type PoolConnect = PoolInstance["connect"];
    type PoolQuery = PoolInstance["query"];

    const ManagedIntegrationPool = function managedIntegrationPool(
      this: PoolInstance,
      config?: PoolConfig,
    ): PoolInstance {
      const effectiveConfig =
        config && typeof config === "object" && !("connectionTimeoutMillis" in config)
          ? { ...config, connectionTimeoutMillis: timeoutMs }
          : config;
      const pool = new OriginalPool(effectiveConfig);
      const originalConnect = pool.connect.bind(pool) as PoolConnect;
      const originalQuery = pool.query.bind(pool) as PoolQuery;

      pool.connect = ((callback?: unknown) => {
        if (typeof callback === "function") {
          return originalConnect(callback as Parameters<PoolConnect>[0]);
        }
        return retryConnectionTimeout(() => originalConnect());
      }) as PoolConnect;

      pool.query = ((...args: unknown[]) => {
        if (args.some((arg) => typeof arg === "function")) {
          return (originalQuery as (...queryArgs: unknown[]) => unknown)(...args);
        }

        return (async () => {
          const client = await retryConnectionTimeout(() => originalConnect());
          try {
            return await client.query(...(args as Parameters<typeof client.query>));
          } finally {
            client.release();
          }
        })();
      }) as PoolQuery;

      return pool;
    } as unknown as typeof OriginalPool;

    Object.setPrototypeOf(ManagedIntegrationPool, OriginalPool);
    ManagedIntegrationPool.prototype = OriginalPool.prototype;

    return {
      ...original,
      Pool: ManagedIntegrationPool,
      default: {
        ...original.default,
        Pool: ManagedIntegrationPool,
      },
    };
  });

  vi.mock("redis", async (importOriginal) => {
    const original = await importOriginal<typeof import("redis")>();
    const originalCreateClient = original.createClient;
    type RedisCreateClient = typeof originalCreateClient;
    type RedisOptions = Parameters<RedisCreateClient>[0] & {
      socket?: Record<string, unknown>;
    };

    const createClient = ((options?: Parameters<RedisCreateClient>[0]) => {
      const effectiveOptions: RedisOptions = {
        ...(options as RedisOptions | undefined),
        socket: {
          ...((options as RedisOptions | undefined)?.socket ?? {}),
          connectTimeout: redisTimeoutMs,
          reconnectStrategy(retries: number) {
            if (retries >= redisRetryAttempts) {
              return false;
            }
            return Math.min((retries + 1) * retryDelayMs, 1_000);
          },
        },
      };

      return originalCreateClient(effectiveOptions);
    }) as RedisCreateClient;

    return {
      ...original,
      createClient,
    };
  });
}
