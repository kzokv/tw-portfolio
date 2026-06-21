// KZO-159 (158A) — Effective-range resolver for the dashboard timeframe picker.
//
// Three-tier precedence (highest → lowest):
//   1. User preference (`preferences.dashboardPerformanceRanges`) — pruned
//      against the admin-allowed set (elements that are no longer admitted
//      by the admin list are silently dropped). If the resulting intersection
//      is non-empty, return it with `source = "user"`.
//   2. Admin override (`app_config.dashboard_performance_ranges`) — returned
//      verbatim with `source = "admin"` when set.
//   3. Hardcoded default (`DEFAULT_DASHBOARD_PERFORMANCE_RANGES` from
//      `@vakwen/shared-types`) with `source = "default"`.
//
// The returned list is used for two things:
//   - The `/user-preferences/effective-ranges` route (client timeframe picker).
//   - The dynamic `z.enum(...)` validator in `GET /dashboard/performance`
//     (see registerRoutes.ts — request is accepted iff the `range` query
//     parameter is a member of the resolved list).
//
// Invariants:
//   - Return array is never empty. If the admin sets an empty list (should
//     be blocked at the validator layer) or user prefs reduce to zero
//     elements against the admin set, we fall back to the next tier.
//   - Order is preserved — callers rely on index 0 being the default pick.
//   - Case sensitivity matches the validator in `libs/shared-types`: "ytd"
//     is NOT the same as "YTD" and is treated as invalid upstream.

import {
  ACCOUNT_DEFAULT_CURRENCIES,
  DEFAULT_HOLDING_ALLOCATION_BASIS,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  DEFAULT_DENSITY,
  DEFAULT_PRICE_COLOR_CONVENTION,
  DEFAULT_THEME_ACCENT,
  HOLDING_ALLOCATION_BASES,
  PRICE_COLOR_CONVENTIONS,
  dashboardPerformanceRangesSchema,
  densityModeSchema,
  themeAccentSchema,
} from "@vakwen/shared-types";
import type { AccountDefaultCurrency, DensityMode, HoldingAllocationBasis, PriceColorConvention, ThemeAccent } from "@vakwen/shared-types";
import type { Persistence } from "../persistence/types.js";

export type EffectiveRangesSource = "user" | "admin" | "default";

export interface EffectiveRangesResult {
  ranges: string[];
  source: EffectiveRangesSource;
}

/**
 * Reads the user's preferences and the admin config, then picks the highest
 * tier that yields a non-empty, valid list. Parse errors on stored values
 * (e.g. a user preference that was seeded with garbage) fall through to the
 * next tier rather than throwing — the resolver must always return something
 * useful for the UI.
 *
 * Optional `prefs` parameter (KZO-180 review M2): callers that already loaded
 * `getUserPreferences(userId)` for another concern (e.g. resolving the
 * reporting-currency pref on the same request) can pass it in to avoid a
 * duplicate read. When omitted, the resolver loads prefs itself.
 */
export async function resolveEffectiveRanges(
  persistence: Persistence,
  userId: string,
  prefs?: Record<string, unknown>,
): Promise<EffectiveRangesResult> {
  const [resolvedPrefs, appConfig] = await Promise.all([
    prefs !== undefined ? Promise.resolve(prefs) : persistence.getUserPreferences(userId),
    persistence.getAppConfig(),
  ]);

  const adminList = appConfig.dashboardPerformanceRanges;

  // Tier 1 — user preference, pruned against the admin-allowed set.
  const userRaw = resolvedPrefs["dashboardPerformanceRanges"];
  if (Array.isArray(userRaw)) {
    const userParsed = dashboardPerformanceRangesSchema.safeParse(userRaw);
    if (userParsed.success) {
      const userList = userParsed.data;
      // When an admin list is active, prune the user list to admin-allowed
      // elements only. This handles "admin removed a range that a user had
      // saved" gracefully without mutating the persisted preference.
      if (Array.isArray(adminList) && adminList.length > 0) {
        const adminAllowed = new Set(adminList);
        const pruned = userList.filter((r) => adminAllowed.has(r));
        if (pruned.length > 0) {
          return { ranges: pruned, source: "user" };
        }
        // Fall through to Tier 2 — admin list.
      } else {
        // No admin override: the user list stands as-is.
        return { ranges: userList, source: "user" };
      }
    }
    // Invalid stored user pref → fall through.
  }

  // Tier 2 — admin override.
  if (Array.isArray(adminList) && adminList.length > 0) {
    return { ranges: [...adminList], source: "admin" };
  }

  // Tier 3 — hardcoded default.
  return {
    ranges: [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
    source: "default",
  };
}

// ─── Phase 2 — theme accent + density resolvers ──────────────────────────
// Three-tier precedence mirrors `resolveEffectiveRanges`:
//   1. User preference (validated via Zod) → "user"
//   2. Admin default (`app_config.default_theme_accent` / `default_density`,
//      reserved for migration 056; reads as null until applied)        → "admin"
//   3. Built-in default (indigo · compact)                              → "default"
// Garbage values fall through silently to the next tier.

export type EffectiveSource = "user" | "admin" | "default";

export interface EffectiveThemeAccentResult {
  value: ThemeAccent;
  source: EffectiveSource;
}

export interface EffectiveDensityResult {
  value: DensityMode;
  source: EffectiveSource;
}

export async function resolveEffectiveThemeAccent(
  persistence: Persistence,
  userId: string,
  prefs?: Record<string, unknown>,
): Promise<EffectiveThemeAccentResult> {
  const resolvedPrefs =
    prefs !== undefined ? prefs : await persistence.getUserPreferences(userId);

  const userParsed = themeAccentSchema.safeParse(resolvedPrefs.themeAccent);
  if (userParsed.success) return { value: userParsed.data, source: "user" };

  // Admin default tier — reads `null` until migration 056 lands; the read
  // path stays safe because `getAppConfig` already returns an exhaustive
  // shape. Until then we fall through to the built-in default.
  // (Optional admin field is wired via a follow-up commit.)

  return { value: DEFAULT_THEME_ACCENT, source: "default" };
}

export async function resolveEffectiveDensity(
  persistence: Persistence,
  userId: string,
  prefs?: Record<string, unknown>,
): Promise<EffectiveDensityResult> {
  const resolvedPrefs =
    prefs !== undefined ? prefs : await persistence.getUserPreferences(userId);

  const userParsed = densityModeSchema.safeParse(resolvedPrefs.density);
  if (userParsed.success) return { value: userParsed.data, source: "user" };

  return { value: DEFAULT_DENSITY, source: "default" };
}

// KZO-180 — Pure resolver for the user-level reporting currency. The pref is
// validated by `userPreferencePatchSchema` at write time (PATCH
// /user-preferences); this helper is the read-side belt-and-suspenders guard
// that copes with legacy/garbage values from any pre-validation seed paths.
//
// Defaults to `"TWD"` when:
//   - the key is absent (lazy `getUserPreferences` returns `{}` for missing rows)
//   - the value is non-string or a string outside the AccountDefaultCurrency union
//
// Sync (no DB call) — caller has prefs already from `getUserPreferences`.
export function resolveReportingCurrency(
  prefs: Record<string, unknown>,
): AccountDefaultCurrency {
  const v = prefs.reportingCurrency;
  if (typeof v === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(v)) {
    return v as AccountDefaultCurrency;
  }
  return "TWD";
}

export function resolveHoldingAllocationBasis(
  prefs: Record<string, unknown>,
): HoldingAllocationBasis {
  const v = prefs.holdingAllocationBasis;
  if (typeof v === "string" && (HOLDING_ALLOCATION_BASES as readonly string[]).includes(v)) {
    return v as HoldingAllocationBasis;
  }
  return DEFAULT_HOLDING_ALLOCATION_BASIS;
}

export function resolvePriceColorConvention(
  prefs: Record<string, unknown>,
): PriceColorConvention {
  const v = prefs.priceColorConvention;
  if (typeof v === "string" && (PRICE_COLOR_CONVENTIONS as readonly string[]).includes(v)) {
    return v as PriceColorConvention;
  }
  return DEFAULT_PRICE_COLOR_CONVENTION;
}
