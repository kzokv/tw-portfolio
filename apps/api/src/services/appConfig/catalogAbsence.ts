/**
 * KZO-195 — Effective resolvers for the diff-based delisting detection knobs.
 * Mirror the KZO-198 Tier 2 hybrid pattern (DB override → env-fallback).
 *
 * The cache layer is consulted via `getAppConfigCacheEntry()`; on cold cache
 * or null override the env default wins. Per `app-config-cache-coherency.md`:
 * cache invalidation + generation counter live in `cache.ts`; the PATCH
 * handler bypasses the cache for response derivation. Per
 * `fastify-app-config-bootstrap.md`: cache is eagerly pre-warmed in
 * `app.ts` before any consumer runs, so these resolvers are safe to call
 * from `runCatalogSync` after `buildApp()` returns.
 */
import { Env } from "@vakwen/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveCatalogAbsenceThreshold(): number {
  return getAppConfigCacheEntry()?.catalogAbsenceThreshold ?? Env.CATALOG_ABSENCE_THRESHOLD;
}

export function getEffectiveCatalogAbsenceGuardPercent(): number {
  return (
    getAppConfigCacheEntry()?.catalogAbsenceGuardPercent ?? Env.CATALOG_ABSENCE_GUARD_PERCENT
  );
}

export function getEffectiveCatalogAbsenceGuardFloor(): number {
  return getAppConfigCacheEntry()?.catalogAbsenceGuardFloor ?? Env.CATALOG_ABSENCE_GUARD_FLOOR;
}
