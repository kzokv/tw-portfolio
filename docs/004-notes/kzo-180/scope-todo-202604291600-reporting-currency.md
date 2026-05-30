---
slug: kzo-180
source: scope-grill
created: 2026-04-29
tickets: [KZO-180]
required_reading:
  - docs/004-notes/kzo-180/scope-todo-202604291600-reporting-currency.md
  - docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md
  - docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md
  - docs/market-data-platform.md
superseded_by: null
---

# Todo: KZO-180 — User-level reporting currency: pref + dashboard FX-aware reads

> **For agents starting a fresh session:** read this file plus the Linear ticket KZO-180 description (the `## Locked Scope` section appended via this session) before starting implementation. Companion files: `apps/api/src/services/userPreferences.ts` (resolver precedent), `apps/api/src/services/dashboard.ts` (read consumers to extend), `apps/api/src/persistence/postgres.ts:2532` (`getFxRate` helper) + `:2750` (existing `getAggregatedSnapshots`), `apps/api/src/routes/registerRoutes.ts:2025` (`userPreferencePatchSchema`) + `:3222` (`/dashboard/overview` route) + `:3239` (`/dashboard/performance` route) + `:1397` (existing `/__e2e/seed-fx-rates`), `apps/web/components/settings/DisplayTabSection.tsx` (UI parent for the new selector), `libs/shared-types/src/index.ts:83` (`AccountDefaultCurrency` reuse) + `:140` (`DashboardOverviewSummaryDto`). Rules: `migration-strategy.md` (no migration in this ticket), `service-error-pattern.md`, `interface-caller-verification.md`, `process-refactor-rename-verification.md` (for `totalCostCurrency` drop), `nextjs-i18n-serialization.md`, `qa-test-infra-check.md`, `test-placement-persistence-backend.md`, `integration-test-persistence-direct.md`, `e2e-oauth-seed-as-browser.md`, `e2e-shared-memory-bars-ticker-hygiene.md`, `commit-format.md`, `code-review-before-pr.md`, `full-test-suite.md`, `pr-bound-docs-review-compliance.md`.

## Context (one-paragraph framing)

KZO-167 landed per-account `default_currency` + `account_type`; KZO-166 lit up the WAC engine and the `getFxRate(base, quote, asOfDate)` helper with forward-fill semantics. Both deferred read-time consumers to KZO-180. The original KZO-180 ticket text bundled three things — the schema, the dashboard FX-aware reads, and the settings UI — and described the schema as "add `reporting_currency CHAR(3) NOT NULL DEFAULT 'TWD'` to `user_preferences`". The scope-grill on 2026-04-29 corrected that contradiction (KZO-158a's `user_preferences` is JSONB-keyed, not column-typed; KZO-159/161/162 all add prefs as JSONB keys), confirmed ship-now is independent of KZO-176 (the per-currency `value_native`/`cost_basis_native`/`unrealized_pnl_native` columns already exist post-KZO-165), and locked nine decisions. KZO-180 ships the `reportingCurrency` JSONB pref + a sibling-file aggregator (`dashboardReportingCurrency.ts`) wiring `/dashboard/overview` summary totals and `/dashboard/performance` time series + a Display-tab selector. KZO-176 will add the sticky dashboard header switcher on top of this infra.

## Decisions (locked via scope-grill 2026-04-29)

- **D1.** Schema is a JSONB key on `user_preferences.preferences`, not a column. Extend `userPreferencePatchSchema` (`registerRoutes.ts:2025`) with `reportingCurrency: z.union([z.enum(["TWD","USD","AUD"]), z.null()]).optional()`. The resolver `resolveReportingCurrency(prefs): AccountDefaultCurrency` (sibling to `resolveEffectiveRanges` in `apps/api/src/services/userPreferences.ts`) defaults to `'TWD'` when prefs missing or invalid. **No migration, no CHECK constraint** — Zod is the single source of truth for the enum. The "column" wording in the ticket body and in `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md:27` is a writing slip; D9 patches the latter.

- **D2.** Ship now, independent of KZO-176. KZO-180 is the FIRST read-time consumer of `getFxRate`. The new aggregation logic lives in a **sibling file** `apps/api/src/services/dashboardReportingCurrency.ts` (not embedded in `dashboard.ts`) so KZO-176's eventual dashboard rewrite can absorb or extend it surgically. The blocking claim in KZO-180's Linear description is wrong — the per-currency native columns the ticket needed (`value_native`/`cost_basis_native`/`unrealized_pnl_native`/`provider_source` on `daily_holding_snapshots`) shipped with KZO-165 and are already round-tripped by `postgres.ts:2680-2849`.

- **D3.** Read-side FX-aware translation lands on **two routes only**: `/dashboard/overview.summary` (5 KPIs: `totalCostAmount`, `marketValueAmount`, `unrealizedPnlAmount`, `dailyChangeAmount`, `upcomingDividendAmount`) and `/dashboard/performance.points[]` (5 series: `totalCostAmount`, `marketValueAmount`, `unrealizedPnlAmount`, `cumulativeRealizedPnlAmount`, `cumulativeDividendsAmount`). **Out of scope:** per-holding rows on `/overview` (each holding stays native), `/portfolio/cash-ledger` (per-wallet WAC story), `/portfolio/dividends/ledger` (security-native ledger), per-event dividend rows on `/overview.dividends.upcoming/recent`. Translating per-holding values across heterogeneous accounts is misleading UX (a TWD position rendered in USD requires the user to mentally undo the FX) — that surface stays native. KZO-176's mockup #1 explicitly preserves the same split (consolidated NAV in reporting currency vs per-market section cards in native).

- **D4.** FX timeline strategy is split by route shape:
  - **`/dashboard/overview` summary totals:** translate at `asOf`-day FX. One `getFxRate(holding.currency, reportingCurrency, asOfDate)` call per unique source currency, cached in a per-request `Map<sourceCurrency, fxRate | null>`. All 5 KPIs translated at the same FX point.
  - **`/dashboard/performance` time series:** translate per-row at each snapshot's `snapshot_date` FX. SQL is a `LEFT JOIN LATERAL` against `market_data.fx_rates` per `(s.currency → reportingCurrency)` per `snapshot_date` (forward-fill via `date <= s.snapshot_date ORDER BY date DESC LIMIT 1`).
  - **Convention:** translate-then-sum (SQL `SUM(value * fx)`), matching multi-currency reporting standard.
  - **v1 deviation from KZO-166 D4:** `cumulative_realized_pnl` is translated at `snapshot_date` FX, not sale-date FX. The denormalized cumulative column doesn't preserve per-trade sale-date breakdown; strict D4 adherence requires a JOIN-to-trades aggregation owned by KZO-176's per-position FX-attribution decomposition. KZO-180 v1 is **correct for TWD-only users** (today's entire production user base) and an approximation for mixed-currency users until KZO-176 lands. Document this explicitly in the scope-todo + a doc-comment on `dashboardReportingCurrency.ts`.

- **D5.** Missing FX rate degradation: when `getFxRate` returns null (no rate ever ingested for the pair), the translated aggregate becomes **NULL**. Response carries metadata so the UI can label the degradation:
  - **Response-level:** `reportingCurrency: AccountDefaultCurrency` + `fxStatus: "complete" | "partial" | "missing"`.
    - `complete` — every contributing row's FX resolved (or self-pair).
    - `partial` — some contributing rows resolved, others did not.
    - `missing` — every contributing row's FX failed (rare; only fires if `market_data.fx_rates` is empty for the requested pair across the whole range).
  - **`/dashboard/performance` per-point:** `fxAvailable: boolean`. When false, the point's translated numeric fields are null.
  - **No native breakdown in v1.** Per-currency `nativeBreakdown` arrays alongside translated aggregates is a candidate for KZO-176 (whose mockup #1 already has per-market-section cards that use this shape). Don't pre-build it here.

- **D6.** Settings UI lives in the **Display tab** (`apps/web/components/settings/DisplayTabSection.tsx`), as a new `<section>` anchored above or below the existing timeframe customizer. Shape: native `<select>` dropdown with three `<option>` entries (TWD/USD/AUD); currency codes render untranslated per KZO-167 D9 convention. Save model: **immediate save on change** — `onChange` PATCHes `/user-preferences` with `{ reportingCurrency: "USD" }` and flashes a "Saved" indicator (mirrors the `runReset` pattern in the same tab, not the multi-step `CustomizeRangesPopover` save-button flow). New i18n keys (en + zh-TW): `displayReportingCurrencyTitle`, `displayReportingCurrencyDescription`, `displayReportingCurrencySaved`. Per `nextjs-i18n-serialization.md`, dictionary stays string-only — no function values.

- **D7.** DTO contract changes (repurpose, not additive):
  - **Drop** `totalCostCurrency: CurrencyCode` from `DashboardOverviewSummaryDto` — its value (`holdings[0]?.currency ?? "TWD"`) was broken-by-design for mixed-currency portfolios.
  - **Repurpose** existing numeric fields to mean "in reporting currency": `totalCostAmount`, `marketValueAmount`, `unrealizedPnlAmount`, `dailyChangeAmount`, `upcomingDividendAmount` (`/overview`) and the 5 `points[]` numeric fields on `/performance`. For TWD-only users (today), the values are unchanged (`fx(TWD, TWD) = 1.0`).
  - **Add** to `DashboardOverviewSummaryDto` and `DashboardPerformanceDto`: `reportingCurrency: AccountDefaultCurrency` + `fxStatus: "complete" | "partial" | "missing"`.
  - **Add** to `DashboardPerformancePointDto`: `fxAvailable: boolean`. The 5 numeric fields on each point become nullable (`number | null`), null when `fxAvailable === false`.
  - **Frontend update in same PR:** the existing dashboard UI (`apps/web/app/dashboard/page.tsx` + sibling components) reads `summary.reportingCurrency` (response-level) for label rendering. Per-holding labels stay on `holding.currency` (per D3). Two label sources on the same page — be explicit during implementation. Per `process-refactor-rename-verification.md`, run `grep -rn "totalCostCurrency" apps/ libs/` before merge to find all callers.

- **D8.** **CRITICAL implementation note — SQL self-pair guard.** The `LEFT JOIN LATERAL` against `market_data.fx_rates` will return zero rows when `s.currency = reportingCurrency` (the table doesn't store self-pairs; `getFxRate`'s `1.0` shortcut for self-pair lives in code). Without an explicit guard, the multiplication `value_native * NULL = NULL` propagates into `SUM`, producing silent NULL aggregates for **all TWD-only users** (today's entire production user base). The SQL must:
  - Gate the LATERAL JOIN: `LEFT JOIN LATERAL (...) fx ON s.currency <> $reportingCurrency`
  - Use a CASE in the multiplication: `SUM(s.value_native * CASE WHEN s.currency = $reportingCurrency THEN 1.0 ELSE fx.rate END)`
  - Compute `fxAvailable` per snapshot_date as `bool_and(s.currency = $reportingCurrency OR fx.rate IS NOT NULL)`
  
  Mirror the same guard pattern in the in-memory aggregator (Phase 4 Memory impl).

- **D9.** Patch `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md:27` in this PR — change "the `user_preferences.reporting_currency` column" to "the `user_preferences.reportingCurrency` JSONB key". Mirrors the precedent set in KZO-167 itself, which patched `docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md:38` to remove a similar contradictory claim about KZO-167's scope. Stale-forward notes adjacent to this PR also get refreshed: update `docs/market-data-platform.md:157` ("Until KZO-180 lands, getFxRate consumers pass 'USD' as the reporting currency") to describe the now-shipped consumer pattern.

## Out of scope (explicit)

- **Per-holding FX translation** on `/dashboard/overview.holdings[]`. Each holding renders in its account's `defaultCurrency`. KZO-176 may extend.
- **`/portfolio/cash-ledger` and `/portfolio/dividends/ledger` translation.** Ledger views show per-wallet/per-event native currency by design.
- **Per-event dividend translation** on `/dashboard/overview.dividends.upcoming/recent`. Only the rolled-up `summary.upcomingDividendAmount` translates.
- **`reportingCurrency` field on the `users` (identity) table.** Per KZO-167 D5, identity != preferences.
- **CHECK constraint at the DB layer.** The valid set lives in the Zod enum + `AccountDefaultCurrency` shared type; coupling the schema to the enum costs a migration on every new currency (JPY, GBP, etc.).
- **Sticky dashboard header currency switcher.** KZO-176 owns the dashboard surface UX; KZO-180 only ships the persisted pref + settings selector.
- **Per-currency native breakdown** alongside translated aggregates (e.g. `total_market_value_native: [{ currency, amount }, ...]`). Defer to KZO-176, where mockup #1 already has the per-market-section card pattern that uses it.
- **Sale-date-locked realized P&L decomposition** (strict KZO-166 D4 adherence). v1 uses snapshot-date FX for `cumulative_realized_pnl`; KZO-176 owns the JOIN-to-trades aggregation.
- **Performance caching for `getFxRate`.** Per KZO-166's deferred follow-up, only add caching if profiling regresses. `/dashboard/performance` for a 1Y range × N positions × indexed lookup is fast enough.
- **`reportingCurrency` parameter on `/dashboard/overview` or `/dashboard/performance` query string** (overriding the user pref ad-hoc). Not requested; explicit pref-only flow keeps the contract simple.

## Acceptance criteria mapping

| Ticket AC | Where satisfied |
| --- | --- |
| `user_preferences` schema can store reporting currency | D1 (JSONB key, no migration); validated by `userPreferencePatchSchema` Zod parse + integration test on `setUserPreferencePatch` |
| Dashboard / portfolio-summary FX-aware reads | D3+D4 (`/dashboard/overview` + `/dashboard/performance`); HTTP test asserts `reportingCurrency` + translated values |
| `getFxRate` helper used as the FX source | D4 (per-currency `Map` for `/overview`, `LEFT JOIN LATERAL` for `/performance`); both honor forward-fill semantics |
| Settings UI dropdown / radio | D6 (Display tab `<select>` immediate save); E2E spec drives the user flow |
| Missing FX rate degrades to native-only on read (KZO-166 D8) | D5 — interpreted as "translated aggregate is null + `fxStatus` reflects degradation"; mixed-currency native fallback is incoherent and deferred to KZO-176 |

## Implementation Steps

### Phase 1 — Types & schema

- [ ] Extend `userPreferencePatchSchema` in `apps/api/src/routes/registerRoutes.ts:2025`:
  ```ts
  const userPreferencePatchSchema = z
    .object({
      dashboardPerformanceRanges: z.union([dashboardPerformanceRangesSchema, z.null()]).optional(),
      cardOrder: z.union([cardOrderSchema, z.null()]).optional(),
      reportingCurrency: z.union([z.enum(["TWD", "USD", "AUD"]), z.null()]).optional(),
    })
    .strict();
  ```
- [ ] Update `libs/shared-types/src/index.ts`:
  - Drop `totalCostCurrency: CurrencyCode` from `DashboardOverviewSummaryDto`.
  - Add `reportingCurrency: AccountDefaultCurrency` + `fxStatus: "complete" | "partial" | "missing"` to `DashboardOverviewSummaryDto`.
  - Add `reportingCurrency: AccountDefaultCurrency` + `fxStatus` to `DashboardPerformanceDto`.
  - Make 5 numeric fields on `DashboardPerformancePointDto` nullable; add `fxAvailable: boolean`.
- [ ] Audit per `shared-types-barrel-turbopack.md`: this is a *type* addition (`export type` augmentation), not a new runtime value export. Should not trigger the value-export trap; verify with E2E run if any unit tests pass but bundling fails.
- [ ] Rebuild `@tw-portfolio/shared-types` so downstream typechecks see the new fields.

### Phase 2 — Resolver helper

- [ ] Add `resolveReportingCurrency(prefs: Record<string, unknown>): AccountDefaultCurrency` to `apps/api/src/services/userPreferences.ts`:
  ```ts
  export function resolveReportingCurrency(prefs: Record<string, unknown>): AccountDefaultCurrency {
    const v = prefs.reportingCurrency;
    if (v === "TWD" || v === "USD" || v === "AUD") return v;
    return "TWD";
  }
  ```
  Pure helper, sync, no persistence call (caller has prefs already from `getUserPreferences`).
- [ ] Unit test in `apps/api/test/unit/userPreferences.test.ts` (extend or sibling): valid values pass through; invalid string defaults to `"TWD"`; missing key defaults to `"TWD"`; non-string values default to `"TWD"`.

### Phase 3 — Persistence FX-aware aggregation

- [ ] Add `getAggregatedSnapshotsInReportingCurrency(userId: string, startDate: string, endDate: string, reportingCurrency: AccountDefaultCurrency): Promise<AggregatedSnapshotPoint[]>` to the `Persistence` interface in `apps/api/src/persistence/types.ts`. The `AggregatedSnapshotPoint` interface gains `fxAvailable: boolean` (every existing field stays).
- [ ] Postgres impl uses the SQL with **D8's self-pair guard** (CRITICAL):
  ```sql
  SELECT s.snapshot_date::text,
         SUM(s.cost_basis_native      * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS total_cost_basis,
         CASE WHEN bool_or(s.is_provisional) THEN NULL ELSE
           SUM(s.value_native * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END)
         END AS total_market_value,
         CASE WHEN bool_or(s.is_provisional) THEN NULL ELSE
           SUM(s.unrealized_pnl_native * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END)
         END AS total_unrealized_pnl,
         SUM(s.cumulative_realized_pnl * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS cumulative_realized_pnl,
         SUM(s.cumulative_dividends    * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS cumulative_dividends,
         bool_or(s.is_provisional) AS is_provisional,
         bool_and(s.currency = $4 OR fx.rate IS NOT NULL) AS fx_available
  FROM daily_holding_snapshots s
  LEFT JOIN LATERAL (
    SELECT rate FROM market_data.fx_rates
    WHERE base_currency = s.currency
      AND quote_currency = $4
      AND date <= s.snapshot_date
    ORDER BY date DESC LIMIT 1
  ) fx ON s.currency <> $4
  WHERE s.user_id = $1
    AND s.snapshot_date >= $2::date
    AND s.snapshot_date <= $3::date
  GROUP BY s.snapshot_date
  ORDER BY s.snapshot_date ASC;
  ```
  Map result rows to `AggregatedSnapshotPoint`, propagating null cumulative/totals when `fx_available = false` AND the underlying row had a non-self-pair native currency.
- [ ] Memory impl (`apps/api/src/persistence/memory.ts`) mirrors the Postgres semantic using existing `getFxRate` per snapshot row × per source currency. Self-pair shortcut: `if (currency === reportingCurrency) fxRate = 1.0; else fxRate = await getFxRate(currency, reportingCurrency, snapshotDate);`.
- [ ] Per `interface-caller-verification.md`, grep callers of `getAggregatedSnapshotsInReportingCurrency` after wiring — must have at least one (the new `dashboardReportingCurrency.ts` aggregator).

### Phase 4 — Sibling aggregator file: `dashboardReportingCurrency.ts`

- [ ] Create `apps/api/src/services/dashboardReportingCurrency.ts`. Two exported async helpers:
  - `translateOverviewSummary(summary, holdings, dividends, reportingCurrency, asOfDate, persistence): Promise<DashboardOverviewSummaryDto>` — pre-fetches per-source-currency FX rates into a `Map`, then translates the 5 KPI fields. Computes `fxStatus` from the Map's null entries. Pure-ish (mutates a fresh DTO, no global state).
  - `translatePerformancePoints(userId, range, asOf, reportingCurrency, persistence, quotes?): Promise<DashboardPerformanceDto>` — calls `getAggregatedSnapshotsInReportingCurrency`, falls back to a synthetic FX-aware path (mirroring `buildSyntheticPerformance` in `dashboard.ts`) when no snapshots exist.
- [ ] Doc comment at the top of the file explicitly cites the **v1 deviation from KZO-166 D4** for `cumulative_realized_pnl` (snapshot-date FX, not sale-date) and the **D8 self-pair guard** rationale. KZO-176's eventual rewrite reads this comment to know what to replace.
- [ ] Pure-helper unit tests: `apps/api/test/unit/dashboardReportingCurrency.test.ts` — TWD-only no-op (every field == native), mixed-currency translation (correct math via mocked `getFxRate`), missing-FX → null + `fxStatus="partial"`.

### Phase 5 — Wire routes

- [ ] `/dashboard/overview` (`registerRoutes.ts:3222`):
  - Inside the handler, after `loadUserStore`: read `prefs = await app.persistence.getUserPreferences(userId)`, derive `reportingCurrency = resolveReportingCurrency(prefs)`.
  - Call `buildDashboardOverview(...)` with the existing arguments, then pipe the result through `translateOverviewSummary(summary, holdings, dividends, reportingCurrency, asOfDate, app.persistence)`.
  - Return the translated DTO.
- [ ] `/dashboard/performance` (`registerRoutes.ts:3239`):
  - Same prefs read at the top of the handler.
  - Replace the call to `buildDashboardPerformance(...)` with `translatePerformancePoints(...)` (which internally calls the FX-aware persistence method).
  - Return the FX-aware `DashboardPerformanceDto`.
- [ ] `buildDashboardOverview` in `apps/api/src/services/dashboard.ts` — keep its current shape (computes the native summary). The wrapper translates. Remove the `totalCostCurrency` field assignment at `dashboard.ts:74`.
- [ ] `buildDashboardPerformance` in `apps/api/src/services/dashboard.ts` — superseded by `translatePerformancePoints`. Either delete (preferred — single read path) OR mark deprecated. Per `interface-caller-verification.md`, grep all callers before deletion.

### Phase 6 — Settings UI

- [ ] Extend `apps/web/components/settings/DisplayTabSection.tsx`:
  - Read current `reportingCurrency` via `GET /user-preferences` on mount (mirror the timeframe pattern). Store in local state with `'TWD'` default.
  - New `<section data-testid="display-reporting-currency-section">` containing:
    - `<h3>{dict.settings.displayReportingCurrencyTitle}</h3>`
    - `<p>{dict.settings.displayReportingCurrencyDescription}</p>`
    - `<select data-testid="reporting-currency-select" value={current} onChange={onSelect}>` with three `<option value="TWD|USD|AUD">{value}</option>`.
    - Optional inline saved-flash span.
  - `onSelect` PATCHes `/user-preferences` with `{ reportingCurrency: nextValue }`, calls `onReportingCurrencySaved` callback prop on success.
  - Add `onReportingCurrencySaved: () => void` to `DisplayTabSectionProps` (defaulting to no-op like the layout-reset callbacks).
- [ ] Pipe `onReportingCurrencySaved` through `SettingsDrawer.tsx` to `AppShell` so the dashboard re-fetches `/dashboard/overview` and `/dashboard/performance` on save (mirror `onTimeframesSaved` wiring). Standard SWR-key invalidation if SWR is in use; otherwise refetch via the existing dashboard data hook.
- [ ] Add i18n keys to the dictionary at `apps/web/lib/i18n/types.ts` (or wherever `dict.settings.*` keys live), in en + zh-TW:
  - `displayReportingCurrencyTitle: "Reporting currency"` / `"報表幣別"`
  - `displayReportingCurrencyDescription: "Choose the currency your dashboard totals are rendered in. Per-holding values stay in each account's native currency."` / `"選擇儀表板總計的顯示幣別。各持股仍以該帳戶的原幣顯示。"`
  - `displayReportingCurrencySaved: "Saved"` / `"已儲存"`
- [ ] Verify `nextjs-i18n-serialization.md` compliance — dictionary stays string-only; the `<option>` labels are inline string literals, NOT function values.

### Phase 7 — Tests

- [ ] **Unit (suite 4 — `apps/api`):**
  - `apps/api/test/unit/userPreferences.test.ts` — extend with `resolveReportingCurrency` cases.
  - `apps/api/test/unit/dashboardReportingCurrency.test.ts` (new) — translation helpers; TWD-only no-op; mixed-currency math with mocked `getFxRate`; missing-FX → null + `fxStatus="partial"`.
- [ ] **Integration (suite 5 — Postgres) per `integration-test-persistence-direct.md`:**
  - `apps/api/test/integration/dashboardReportingCurrencyAggregation.integration.test.ts` (new). Use `PostgresPersistence` directly. Seed a real user via `resolveOrCreateUser`. Cases:
    1. **Self-pair (TWD-only, reporting=TWD):** seed TWD-native daily snapshots; assert `getAggregatedSnapshotsInReportingCurrency` returns the same values as `getAggregatedSnapshots` would, with `fx_available=true` per row. **This is the regression guard for D8 — without the self-pair SQL guard, every row has `fx.rate IS NULL` and the SUMs are NULL.**
    2. **Cross-currency (USD positions, reporting=TWD):** seed USD-native snapshots + USD→TWD FX rates; assert SUMs translate correctly (translate-then-sum convention).
    3. **Missing FX:** seed USD position, NO USD→TWD FX rate; assert SUMs are NULL + `fx_available=false` for affected rows.
    4. **Forward-fill:** seed USD→TWD FX on day N-5 only; query day N; assert FX from day N-5 is used.
- [ ] **HTTP (suite 8 — `apps/api`) per `qa-test-infra-check.md`:**
  - Verify `/__e2e/seed-fx-rates` is wired into the test config — already present (`registerRoutes.ts:1397`); no infra work needed.
  - New or extended `apps/api/test/http/specs/dashboard-reporting-currency-aaa.http.spec.ts`:
    - GET `/dashboard/overview` for a default user → `summary.reportingCurrency === "TWD"`, `summary.fxStatus === "complete"`, no `totalCostCurrency` field.
    - PATCH `/user-preferences` with `{ reportingCurrency: "USD" }` → 200; subsequent GET reflects.
    - PATCH `/user-preferences` with `{ reportingCurrency: "EUR" }` → 400 (Zod rejects).
    - Seed TWD positions + TWD→USD FX rates; PATCH to `"USD"`; GET `/dashboard/overview` → `summary.totalCostAmount` is the TWD value × FX(TWD,USD,asOf), `summary.reportingCurrency === "USD"`.
    - Seed USD positions WITHOUT FX rates; PATCH to `"TWD"`; GET → `summary.marketValueAmount === null`, `summary.fxStatus === "partial"` or `"missing"`.
    - GET `/dashboard/performance?range=1Y` after currency switch → response has `reportingCurrency`, `fxStatus`, and per-point `fxAvailable`.
- [ ] **Web unit (suite 3 — `apps/web`):**
  - New: settings selector logic test (mounting `DisplayTabSection`, mocking `/user-preferences`, asserting PATCH on change + saved-flash).
  - Update existing `dashboard` consumer tests / fixtures to drop `totalCostCurrency` and add `reportingCurrency`.
- [ ] **E2E (suite 7 — `apps/web` OAuth — Settings drawer requires real session per `e2e-oauth-seed-as-browser.md`):**
  - New `apps/web/tests/e2e/specs-oauth/dashboard-reporting-currency-aaa.spec.ts`:
    - Seed-before-navigate per `e2e-oauth-seed-as-browser.md`: seed reportingCurrency to "TWD" + seed any required FX rates BEFORE navigation.
    - Open settings drawer → Display tab → assert dropdown shows TWD selected.
    - Switch to USD via the `<select>` → wait for saved flash.
    - Close drawer; assert dashboard summary KPI label shows "USD" (and values translated, if seed includes positions with known FX).
  - Per `e2e-shared-memory-bars-ticker-hygiene.md`: if the spec seeds any new daily bars, pick a unique ticker NOT used by other specs (grep first; current reservation list in the rule).
- [ ] **Existing E2E grep** — `grep -rn "totalCostCurrency\|summary\\.totalCostCurrency" apps/web/tests/e2e/` to find any specs that read the dropped field; update.

### Phase 8 — Doc updates & cross-ticket cleanup

- [ ] **Patch (D9):** edit `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md:27` — change "the `user_preferences.reporting_currency` column" to "the `user_preferences.reportingCurrency` JSONB key". Add a one-line `**Patched in KZO-180:**` note adjacent to the change for traceability.
- [ ] **Update** `docs/market-data-platform.md:157` — replace the now-stale "Until KZO-180 lands, getFxRate consumers pass 'USD' as the reporting currency" sentence with a description of the shipped consumer pattern (resolver helper + sibling aggregator + the v1 deviation note).
- [ ] **Add a paragraph** to `docs/001-architecture/backend-db-api.md` (or the closest evergreen architecture doc) covering the new resolver + sibling aggregator + the `reportingCurrency` / `fxStatus` / `fxAvailable` contract on the dashboard DTOs. Per `doc-stale-forward-notes.md`, REPLACE in place — do not append a duplicate "future candidate" note.
- [ ] **Add transition note:** `docs/004-notes/kzo-180/transition-{datetime}-reporting-currency.md` after merge. Per `doc-management.md`, frozen snapshot, datetime-named.
- [ ] **Update `## Locked Scope`** on KZO-180 (done in this scope-grill session).

### Phase 9 — Pre-PR / pre-push gates (reviewer checklist)

- [ ] Run the canonical pre-push gate per `full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [ ] Run `/code-reviewer` per `code-review-before-pr.md` and produce review doc at `docs/004-notes/kzo-180/review-{datetime}-iter1.md`.
- [ ] Verify reviewer-rule compliance:
  - `service-error-pattern.md` — Zod rejection at PATCH `/user-preferences` returns `routeError(400, "invalid_preference", ...)` (existing path); no new error codes for KZO-180.
  - `migration-strategy.md` — **no migration in this ticket** (D1). If a reviewer flags the absence as suspicious, the answer is in D1 + the `## Out of scope` section.
  - `interface-caller-verification.md` — the new `getAggregatedSnapshotsInReportingCurrency` persistence method has at least one caller (`dashboardReportingCurrency.ts`); the (deleted-or-deprecated) `buildDashboardPerformance` was grep'd before removal.
  - `process-refactor-rename-verification.md` — `totalCostCurrency` callers grep'd and updated in same PR.
  - `nextjs-i18n-serialization.md` — i18n dictionaries are string-only.
  - `qa-test-infra-check.md` — `/__e2e/seed-fx-rates` infra confirmed wired before E2E spec authoring.
  - `e2e-oauth-seed-as-browser.md` — seed-before-navigate followed in the OAuth spec.
  - `e2e-shared-memory-bars-ticker-hygiene.md` — any new daily-bar seed picks a unique ticker.
  - `commit-format.md` — `feat(api,web): KZO-180: ...` shape.
  - `pr-bound-docs-review-compliance.md` — PR description has `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback`.

## Open Items

None. No debate triggered; all decisions reached in Phase 1 and the Phase 1.5 gap check.

## References

- Linear: KZO-180 (this ticket); KZO-167 (parent — per-account currency); KZO-166 (sibling — WAC engine + `getFxRate` producer); KZO-176 (forward — dashboard rewrite that consumes this infra and adds the sticky header switcher); KZO-159 (precedent — `user_preferences` JSONB pref pattern).
- Companion docs:
  - `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md` (parent scope-todo; D9 patches line 27)
  - `docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md` (sibling — WAC engine + D8 missing-FX semantics)
  - `docs/market-data-platform.md` (line 157 needs an update post-KZO-180)
- Code anchors:
  - `apps/api/src/services/userPreferences.ts` — resolver precedent (`resolveEffectiveRanges`)
  - `apps/api/src/services/dashboard.ts:38-119` — existing `buildDashboardOverview` + `buildDashboardPerformance`
  - `apps/api/src/persistence/postgres.ts:2532` — `getFxRate` helper
  - `apps/api/src/persistence/postgres.ts:2750` — existing `getAggregatedSnapshots` to mirror the SQL shape
  - `apps/api/src/routes/registerRoutes.ts:1397` — `/__e2e/seed-fx-rates` (test infra confirmed present)
  - `apps/api/src/routes/registerRoutes.ts:2025` — `userPreferencePatchSchema` extension point
  - `apps/web/components/settings/DisplayTabSection.tsx` — UI parent for the new selector
  - `libs/shared-types/src/index.ts:83` — `AccountDefaultCurrency` reuse
