import { Env } from "@tw-portfolio/config";
import { getAppConfigCacheEntry } from "./cache.js";

/**
 * KZO-196 — Effective AU GICS sync cron schedule.
 *
 * Resolves DB override (`app_config.asx_gics_refresh_cron`) → env fallback
 * (`Env.ASX_GICS_REFRESH_CRON`). Cache miss / pending / load-failure → env
 * fallback. Plain-text return; the consumer (`pgBoss.ts`) feeds it directly
 * into `boss.schedule(...)`.
 *
 * Restart-required to take effect: pg-boss `schedule()` is called once at
 * boot; live-edit is explicitly out of scope per the KZO-196 scope-todo.
 * The DB column exists for forward-compat (operators can swap the cron
 * without an env-file edit on next deploy).
 */
export function getEffectiveAsxGicsRefreshCron(): string {
  const db = getAppConfigCacheEntry()?.asxGicsRefreshCron ?? null;
  return db ?? Env.ASX_GICS_REFRESH_CRON;
}
