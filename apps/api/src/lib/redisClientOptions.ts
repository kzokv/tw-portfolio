import { Env } from "@vakwen/config";

export function buildRedisSocketOptions() {
  return {
    connectTimeout: Env.REDIS_CONNECTION_TIMEOUT_MS,
    reconnectStrategy(retries: number) {
      if (retries >= Env.REDIS_RECONNECT_MAX_RETRIES) {
        return false;
      }
      return Math.min((retries + 1) * 250, 1_000);
    },
  };
}
