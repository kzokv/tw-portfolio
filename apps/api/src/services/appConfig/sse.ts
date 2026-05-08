/**
 * KZO-198 — SSE knob resolvers. DB override wins; env-fallback otherwise.
 */
import { Env } from "@tw-portfolio/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveSseHeartbeatIntervalMs(): number {
  return getAppConfigCacheEntry()?.sseHeartbeatIntervalMs ?? Env.SSE_HEARTBEAT_INTERVAL_MS;
}

export function getEffectiveSseMaxConnectionsPerUser(): number {
  return getAppConfigCacheEntry()?.sseMaxConnectionsPerUser ?? Env.SSE_MAX_CONNECTIONS_PER_USER;
}

export function getEffectiveSseBufferDefaultTtlMs(): number {
  return getAppConfigCacheEntry()?.sseBufferDefaultTtlMs ?? Env.SSE_BUFFER_DEFAULT_TTL_MS;
}
