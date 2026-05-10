/**
 * KZO-199 — request-limit knob resolvers. DB override (when set) wins;
 * env-fallback otherwise. Generic file name reserved for future per-route
 * body caps. Currently single field.
 *
 * Used by `PATCH /user-preferences` for the runtime-tunable inner check
 * (Fastify route's static `bodyLimit` stays at the bound max — see
 * `.claude/rules/fastify-eviction-lifecycle-pattern.md` § "schedule static,
 * parameter live").
 */
import { Env } from "@tw-portfolio/config";
import { getAppConfigCacheEntry } from "./cache.js";

export function getEffectiveUserPreferencesMaxBytes(): number {
  return getAppConfigCacheEntry()?.userPreferencesMaxBytes ?? Env.USER_PREFERENCES_MAX_BYTES;
}
