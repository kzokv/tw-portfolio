import { Env } from "@vakwen/config";
import { getAppConfigCacheEntry } from "./cache.js";

/**
 * Effective AU metadata enrichment mode (KZO-189, migrated to KZO-198 cache
 * layer): DB value when set, else env fallback. Single source of truth —
 * admin route DTO mapper and the backfill worker functor both call this.
 *
 * Reads from the `app_config` TTL cache — no `persistence` parameter. Cache
 * miss / pending / load-failure → env fallback.
 */
export function getEffectiveMetadataEnrichmentMode(): "unconditional" | "conditional" {
  const db = getAppConfigCacheEntry()?.metadataEnrichmentMode ?? null;
  return db ?? Env.METADATA_ENRICHMENT_MODE;
}
