---
slug: kzo-158
ticket: KZO-159 (158A)
type: transition-guide
created: 2026-04-22
status: final
companion: design-202604221530-kzo-159-initial.md
---

# Transition Guide: KZO-159 (158A) — User Prefs Infra + Admin Timeframe Config

## What shipped

KZO-159 lands the data plumbing that KZO-161 (158C) consumes. No user-facing customization UI — that is 158C's scope.

| Slice | What shipped |
|---|---|
| **Migration 036** | `user_preferences` table + `app_config.dashboard_performance_ranges` column. Idempotent, backward-compatible. |
| **Range parser library** | `libs/domain/src/performanceRange.ts` — pure `parsePerformanceRange`, `resolveRangeBounds`, `isValidPerformanceRange`. Re-exported from `@tw-portfolio/shared-types`. |
| **Shared zod schema** | `dashboardPerformanceRangesSchema` + `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` exported from `@tw-portfolio/shared-types`. |
| **`DashboardPerformanceRange` type widening** | Changed from closed union `"1M" \| "3M" \| "YTD" \| "1Y"` to `string` (runtime-validated). |
| **`GET/PATCH /user-preferences`** | Per-user JSONB prefs. Lazy insert (no row on read). Top-level merge semantics. 8 KB cap. Allowlisted top-level keys. |
| **`GET /user-preferences/effective-ranges`** | 3-tier resolver → `{ ranges, source: "user" \| "admin" \| "default" }`. |
| **Dynamic `/dashboard/performance` validator** | `range` query param validated against caller's effective-ranges list — replaces the previous static `z.enum(["1M","3M","YTD","1Y"])`. |
| **`PATCH /admin/settings` extension** | Accepts `dashboardPerformanceRanges: string[] \| null`. Emits `app_config_updated` audit entry. |
| **AdminSettingsClient — Dashboard Timeframe Defaults section** | Chip-toggles, custom range input, up/down reorder buttons, Reset to defaults, Save. Helper text: "Users can override these defaults in their own Display Preferences." |
| **`POST /__e2e/seed-user-preferences`** | Test-only seed endpoint. Guarded by `assertE2ESeedEnabled()`. |
| **AppShell + PortfolioTrendCard wiring** | AppShell fetches `GET /user-preferences/effective-ranges` on mount via `useEffect`+`getJson`; passes as optional prop to `PortfolioTrendCard` (falls back to `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` on error). |
| **Tests** | Parser unit tests (58), memory-sibling unit tests (8), Postgres integration tests (34), HTTP spec (16 in suite 8), admin-timeframe AAA E2E (12 in suite 7). All 8 suites green. |

---

## Behavioral changes

### `/dashboard/performance?range=X` validator is now dynamic

**Before:** Static `z.enum(["1M","3M","YTD","1Y"])`. Any request with a range not in this fixed list → `400 validation_error`.

**After:** Dynamic `z.enum([...effectiveRanges])` built per-request from `resolveEffectiveRanges`. A request with `range=5Y` is accepted if and only if `5Y` is in the caller's resolved effective list. Out-of-list → `400 invalid_range` (error code changed from `validation_error`).

**Impact:** No regressions if callers only use the 4 legacy values (`1M`, `3M`, `YTD`, `1Y`) — these remain in the default list. Test assertions hardcoded to the old `validation_error` code on range rejection should be updated to `invalid_range`.

### `DashboardPerformanceRange` type widened to `string`

**Before:** `type DashboardPerformanceRange = "1M" | "3M" | "YTD" | "1Y";`

**After:** `type DashboardPerformanceRange = string;`

**Impact:** TypeScript code that pattern-matched the old union (e.g. `switch (range)` with a default branch that was dead code) will no longer get a compile-time exhaustiveness check from the type alone. Runtime validation via `parsePerformanceRange` or `dashboardPerformanceRangesSchema` is now the safety net. If 158C adds client-side range filtering, use `parsePerformanceRange` from `@tw-portfolio/shared-types`, not type narrowing.

### Shared-types barrel now has runtime value exports

**Before:** `libs/shared-types/src/index.ts` re-exported only types and `./events.js` was a bare `export *`.

**After:** The barrel now re-exports runtime values (`DEFAULT_DASHBOARD_PERFORMANCE_RANGES`, `dashboardPerformanceRangesSchema`, parser functions from `@tw-portfolio/domain`). The `events.js` re-export was changed to `export type *` to avoid Turbopack resolution failures (Turbopack processes barrels with runtime value imports and fails on `./events.js` which resolves to `./events.ts` — only `.ts` exists, not `.js`).

**Impact:** Any future addition of runtime value exports to this barrel must audit sibling `export * from './submodule.js'` lines. Pure-type submodules must use `export type *`. This is now documented in `docs/004-notes/kzo-158/` (Turbopack barrel incident).

---

## Migration

### 036 (`036_kzo158a_user_preferences.sql`)

- **Creates** `user_preferences(user_id TEXT PK, preferences JSONB, created_at, updated_at)` with `ON DELETE CASCADE` on `users.id`.
- **Adds** `app_config.dashboard_performance_ranges JSONB NULL`.
- Idempotent: `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`. Safe to re-apply.
- **No rollback SQL.** The additions are additive and backward-compatible with pre-KZO-159 API images (nullable column, new table ignored by old code). To manually rollback: `DROP TABLE user_preferences; ALTER TABLE app_config DROP COLUMN dashboard_performance_ranges;`

---

## Dependency contract for KZO-161 (158C)

158C implementers can rely on everything listed here being present and tested in `dev` before 158A merges:

| Artifact | Location | Notes |
|---|---|---|
| `user_preferences` table | `db/migrations/036_kzo158a_user_preferences.sql` | Lazy-insert; FK cascade on user delete |
| `app_config.dashboard_performance_ranges` column | Same migration | Nullable; null = default |
| `parsePerformanceRange(str)` | `@tw-portfolio/shared-types` (re-exported from `@tw-portfolio/domain`) | Returns `ParsedRange \| null` |
| `resolveRangeBounds(rangeString, asOf, earliestTradeDate?)` | `@tw-portfolio/shared-types` | Returns `{ startDate, endDate }` ISO strings |
| `isValidPerformanceRange(str)` | `@tw-portfolio/shared-types` | Boolean convenience wrapper |
| `dashboardPerformanceRangesSchema` | `@tw-portfolio/shared-types` | Zod array validator (min 1, max 12, no dupes) |
| `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` | `@tw-portfolio/shared-types` | `["1M","3M","YTD","1Y"] as const` |
| `GET /user-preferences` | API | Returns `{ preferences: {} }` on first call |
| `PATCH /user-preferences` | API | Top-level merge; `null` deletes key; 8 KB cap; allowlisted keys |
| `GET /user-preferences/effective-ranges` | API | 3-tier → `{ ranges, source }` |
| `POST /__e2e/seed-user-preferences` | API (test-only) | Full-replace seed; `assertE2ESeedEnabled()` guard |
| `AppConfigDto.dashboardPerformanceRanges` | `@tw-portfolio/shared-types` | `string[] \| null` |
| `AppConfigDto.effectiveDashboardPerformanceRanges` | `@tw-portfolio/shared-types` | `string[]` (resolved list) |

**Key constraints for 158C:**
- User prefs use `requireSessionUserId` — always the session owner's prefs, regardless of which portfolio is being viewed.
- Effective-ranges auto-prune at resolve time — never rewrite stored user prefs.
- `card_order` top-level key is accepted and persisted by the PATCH route but not yet surfaced in UI — 158C owns the read-back and render.
- dnd-kit dependency is 158C scope only (not present in 158A). Admin uses simple up/down buttons.

---

## Known gaps / out of scope for 158A

| Gap | Deferred to |
|---|---|
| User-facing customization popover (gear icon, `···` menu, "Customize Ranges" popover) | KZO-161 (158C) |
| dnd-kit drag-drop for range reorder in user popover | KZO-161 (158C) |
| Card reorder UI and `card_order` persistence surface in UI | KZO-161 (158C) |
| Rate limiting on user-prefs endpoints | Future if needed; admin gate covers `/admin/settings` |
| Transaction form fee pre-fill, account rename, price pre-fill | KZO-160 (158B) — independent |
| Admin drag-drop upgrade for chip reorder | Future polish pass when 158C lands dnd-kit |

---

## Informational notes from code review

- **INFO-5 (wave2_deferred):** Design doc §D9 referred to a `parseDashboardPerformanceRange` export name. The actual shipped name is `parsePerformanceRange` (re-exported from `@tw-portfolio/domain` under the same name into `@tw-portfolio/shared-types`). No `parseDashboardPerformanceRange` symbol exists anywhere in the codebase. The design doc is a frozen snapshot and has not been updated; this note documents the discrepancy.
- **AdminSettingsClient validation:** Uses `dashboardPerformanceRangesSchema.safeParse([value]).success` as a single-element chip validator (no import of `parsePerformanceRange` directly) — architecturally superior to dual validation surfaces. This resolved CRITICAL-1 from the code review.
- **Turbopack barrel incident:** See `finding_log` entry in `state.json` and the rule promotion deferred to the memory curator in `wave2_deferred`.

---

## Known follow-ups

- **Admin reorder UX (↑↓ arrow buttons in 158A):** `AdminSettingsClient` "Dashboard Timeframe Defaults" section uses ↑↓ arrow buttons for active-list reorder. This is a deliberate UX fidelity defer per user decision 2026-04-22 — dnd-kit was not pulled into 158A to keep the shared-prefs infra ticket narrow and avoid a premature dependency on the 158C drag-drop spike.

- **158C (KZO-161) retrofit scope:** During the card-reorder rollout, 158C must retrofit `AdminSettingsClient`'s reorder control from ↑↓ arrow buttons to dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable`) to match the user-facing customization surface once dnd-kit is proven by the Playwright spike.

- **AAA spec change required in 158C:** `apps/web/tests/e2e/specs-oauth/admin-timeframe-defaults-aaa.spec.ts` scenarios that currently click ↑↓ buttons (`timeframe-chip-up-{range}` / `timeframe-chip-down-{range}` testids) must be rewritten in 158C to use Playwright's `locator.dragTo(target)` against dnd-kit drag handles once the retrofit lands.

- **Tracking:** KZO-161 ticket scope will be updated to include this retrofit. Scope tag: `158C-retrofit-admin-reorder`.
