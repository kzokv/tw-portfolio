/**
 * ui-enhancement — Tier B resolver for the account soft-delete grace period.
 *
 * The cron worker calls this AT TICK TIME (not at registration) so admin
 * overrides via `PATCH /admin/settings.accountHardPurgeDays` take effect on
 * each daily run without a redeploy — same "schedule static, sweep-parameter
 * live" pattern documented in `.claude/rules/fastify-eviction-lifecycle-pattern.md`.
 *
 * Returns the effective grace period in DAYS:
 *   - DB override (`app_config.account_hard_purge_days`) when present,
 *   - else `Env.ACCOUNT_HARD_PURGE_DAYS` (default 30).
 */
import { Env } from "@tw-portfolio/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveAccountHardPurgeDays(): number {
  return getAppConfigCacheEntry()?.accountHardPurgeDays ?? Env.ACCOUNT_HARD_PURGE_DAYS;
}
