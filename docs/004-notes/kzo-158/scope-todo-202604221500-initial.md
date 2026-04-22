---
slug: kzo-158
source: scope-grill
created: 2026-04-22
tickets: [KZO-158, KZO-159, KZO-160, KZO-161]
required_reading: [kzo-158-ui-mockups.png, .worklog/kzo-158-ui-mockups.html]
superseded_by: null
---

# Todo: KZO-158 UI Enhancements — 3-Ticket Split

> **For agents starting a fresh session:** read all files listed in `required_reading` before starting implementation. The three sub-tickets (158A/B/C) are gated on strict dependency ordering — 158C blocks on 158A. 158B is independent.

Scope-locked via `/scope-grill` on 2026-04-22. 20 architectural decisions captured below. Three sub-tickets derived from this scope; see `## References` for Linear IDs once created.

---

## Ticket Ordering

| Ticket | Scope | Depends on | Can start |
| -- | -- | -- | -- |
| **KZO-159** (158A) | Shared prefs infra + admin timeframe config + range parser | — | Immediately |
| **KZO-160** (158B) | Transaction form polish (F1 + F2 + F3) | — | Immediately, parallel with KZO-159 |
| **KZO-161** (158C) | User timeframe customization (F4 user UI) + card reorder (F5) | KZO-159 merged | After KZO-159 ships |

---

## KZO-158A — Shared prefs + admin timeframe config + range parser

**Goal:** Land the data plumbing (user_preferences table, admin config column, range parser) that 158C consumes. No user-facing customization UI in this ticket.

### Implementation Steps

- [ ] **Migration 036** — single file `036_kzo158a_user_preferences.sql`. Creates `user_preferences (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preferences JSONB NOT NULL DEFAULT '{}')`. Adds `app_config.dashboard_performance_ranges JSONB` column (nullable, null = use hardcoded default).
- [ ] Create `libs/domain/src/performanceRange.ts` — pure functions:
  - [ ] `parsePerformanceRange(str)` — regex `/^([1-9]\d*)(M|Y)$|^YTD$|^ALL$/`, case-sensitive
  - [ ] `resolveRangeBounds(rangeString, asOf, earliestTradeDate)` — handles `YTD`, `ALL`, `{n}M`, `{n}Y`. Bounds: `M ≤ 240`, `Y ≤ 50`
  - [ ] Shared zod schema for range list: min 1, max 12, reject duplicates, reject invalid format
- [ ] Export range schema from `libs/shared-types` so admin and user validators share one source
- [ ] Refactor `apps/api/src/services/dashboard.ts:443` `resolveRangeBounds` to delegate to `libs/domain/src/performanceRange.ts`. Update `DashboardPerformanceRange` type in `libs/shared-types/src/index.ts:152` to `string` (validated at runtime) — keep the type alias for call-site clarity.
- [ ] **`GET /user-preferences`** — returns `{ preferences: {} }` when no row exists; no lazy insert on read
- [ ] **`PATCH /user-preferences`** — strict unknown-key allowlist (400), 8 KB request cap (413), `jsonb_set` per top-level key in single UPDATE, `null` deletes key, arrays replaced atomically. `INSERT ... ON CONFLICT (user_id) DO UPDATE` for lazy row creation
- [ ] **Effective ranges endpoint** — either new `GET /user-preferences/effective-ranges` or fold into `GET /dashboard/overview`. Returns `{ ranges: string[], source: "user" | "admin" | "default" }`. Auto-prune user's list to admin-allowed set at resolve time (never rewrite stored prefs)
- [ ] **Refactor `/dashboard/performance?range=X`** at `registerRoutes.ts:2630` — replace static `z.enum(["1M","3M","YTD","1Y"])` with dynamic `z.enum([...effectiveRanges])` built per-request. Out-of-list → 400
- [ ] **Extend `PATCH /admin/settings`** schema at `adminRoutes.ts:17-19` to accept `dashboardPerformanceRanges` (validated by shared zod schema)
- [ ] **Extend `AdminSettingsClient.tsx`** with "Dashboard Timeframe Defaults" section:
  - [ ] Chip toggles for `{1M, 3M, YTD, 1Y, 5Y, 10Y}` (all on by default)
  - [ ] Custom range text input with inline validation error
  - [ ] Drag-reorder active list (admin only — dnd-kit comes in 158C, so use simple up/down buttons here OR defer drag until 158C lands and add follow-up). Decide during implementation.
  - [ ] Save / Reset buttons
  - [ ] Helper text: "Users can override these defaults in their own Display Preferences"
- [ ] **`POST /__e2e/seed-user-preferences`** — guarded by `assertE2ESeedEnabled()` (seed guard, not reset — per `e2e-seed-vs-reset-guards.md`). Body: `{ userId?: string, preferences: Preferences }`. Defaults `userId` to caller's effective user
- [ ] Integration tests for `GET/PATCH /user-preferences` in `apps/api/test/integration/` — use `PostgresPersistence` directly, not `buildApp` (per `integration-test-persistence-direct.md`)
- [ ] Unit tests for `parsePerformanceRange` and `resolveRangeBounds` in `libs/domain/test/`
- [ ] Run `/aaa` to add AAA E2E coverage for the admin timeframe-defaults section
- [ ] **Pre-PR:** `/code-reviewer` → fix findings → full 8-suite gate: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`

### Non-goals (158A)
- User-facing popover, gear icon, drawer entry — **158C**
- dnd-kit — **158C**
- Transaction form changes — **158B**

---

## KZO-158B — Transaction form polish (F1 + F2 + F3)

**Goal:** Surface fee profile in account label, pre-fill unit price from market data, pre-fill fee estimates. All additive — no new tables, no shared dependency on 158A.

### F1 — Account display + inline rename

- [ ] **`GET /accounts`** at `registerRoutes.ts:2218` joins `fee_profiles.name` into response; extend `AccountDto` at `libs/shared-types/src/index.ts:53-58` with `feeProfileName: string`
- [ ] **`PATCH /accounts/:id`** at `registerRoutes.ts:2223-2243`: make `feeProfileId` optional; add `.refine(v => v.name !== undefined || v.feeProfileId !== undefined, "at least one field required")`
- [ ] `AddTransactionCard.tsx:37,65` render `{accountName} — {feeProfileName}`, drop UUID. Add testid `account-selector`
- [ ] `AccountFallbackSection.tsx`: pencil icon next to account name → inline `<input>` + Save/Cancel
  - [ ] Save disabled when name empty (client-side)
  - [ ] Save: `PATCH /accounts/:id` with `{ name }`
  - [ ] Cancel: restore original, no API call
  - [ ] Testids: `account-name-label`, `account-rename-icon`, `account-name-input`, `account-rename-save`, `account-rename-cancel`

### F2 — Unit price pre-fill

- [ ] New route **`GET /market-data/price?ticker&date`** — response contract:
  - Exact match: `{ close, date, source: "db"|"finmind", match: "exact" }` → 200
  - Fallback: `{ close, date, source, match: "previous", reason: "weekend"|"holiday"|"no_bar" }` → 200
  - Not found anywhere: `{ error: "price_not_found" }` → 404
- [ ] Reject future dates at validation (400 `invalid_date`)
- [ ] Lookup chain: exact `daily_bars` match → most recent prior bar (≤ 7 days lookback) → FinMind 7-day lookback
- [ ] On FinMind hit, opportunistic upsert into `daily_bars` with `source: 'finmind'`
- [ ] **Rate limiter** in new file `apps/api/src/lib/marketDataPriceRateLimit.ts`: `registerMarketDataPriceEviction(app)` factory with 30 req/min sliding window per-user, per `fastify-eviction-lifecycle-pattern.md`. Call from `registerRoutes.ts` before route handlers
- [ ] 429 on rate-limit breach; UI renders same red "unavailable" hint
- [ ] i18n keys: `dict.priceHint.exact`, `dict.priceHint.previous.weekend`, `dict.priceHint.previous.holiday`, `dict.priceHint.previous.no_bar`, `dict.priceHint.unavailable` — all string templates, no functions (per `nextjs-i18n-serialization.md`)
- [ ] Testids: `unit-price-input`, `price-source-hint`, `price-unavailable-hint`

### F3 — Fee estimate

- [ ] New route **`POST /transactions/estimate`** — body `{ ticker, quantity, unitPrice, type, isDayTrade, accountId }`, returns `{ commissionAmount, taxAmount }`
- [ ] Uses `calculateBuyFees` / `calculateSellFees` from `libs/domain/src/fee.ts` (pure functions, verified no side effects)
- [ ] Commission section (BUY + SELL): `Estimated: NT$X` read-only line + optional `Override` text input
- [ ] Securities Tax section (SELL only, hidden for BUY): same pattern
- [ ] Submit: empty override → omit field from payload (server uses estimate); filled override → value sent verbatim
- [ ] Testids: `commission-estimate-section`, `commission-estimate-value`, `commission-override-input`, `tax-estimate-section`, `tax-estimate-value`, `tax-override-input`

### F2 + F3 shared debounce chain

- [ ] Single coalesced `useEffect` watching `[ticker, tradeDate, type, isDayTrade, quantity, unitPrice, accountId]`, 400 ms debounce
- [ ] Sequential dependent execution:
  1. If `ticker` or `tradeDate` changed AND `!hasUserEditedUnitPrice`: fetch price. On success, write `unitPrice` (re-triggers effect).
  2. If `unitPrice > 0 && quantity > 0 && accountId`: fetch fee estimate. On success, write to display state.
- [ ] `AbortController` on every fetch; abort prior in-flight when effect re-fires
- [ ] `hasUserEditedUnitPrice` flag: flips true on manual unitPrice change; reset to false when ticker or tradeDate changes
- [ ] In-memory `Map<"ticker|date", { close, date, source }>` cache, 60 s TTL
- [ ] Skip fee estimate on price-fetch failure; display neutral hint

### Tests (158B)

- [ ] All new route errors use `routeError(status, code, message)` per `service-error-pattern.md`
- [ ] Run `/aaa` to produce 3 AAA specs: `account-display-aaa.spec.ts`, `transaction-price-prefill-aaa.spec.ts`, `transaction-fee-estimate-aaa.spec.ts`
- [ ] **Pre-PR:** `/code-reviewer` → fix → full 8-suite gate

---

## KZO-158C — User timeframe customization + card reorder (blocked on 158A)

**Goal:** User-facing timeframe customization surface; drag-drop card reordering on Dashboard. Consumes 158A's `user_preferences` infra.

### Pre-flight (first sub-task — halt and rescope on failure)

- [ ] **2-hour dnd-kit + Playwright spike.** Build a minimal `<SortableContext>` fixture; prove `locator.dragTo()` produces the expected `onDragEnd` event. If it doesn't work cleanly, **halt and rescope** — do not burn convergence-loop iterations on test flakiness.
- [ ] Add dnd-kit to `apps/web/package.json`: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

### F4 — User timeframe customization

- [ ] `PortfolioTrendCard.tsx`: add `⚙️` gear icon top-right (hidden on mobile breakpoints) + `···` button after last pill. Both open the same "Customize Ranges" popover
- [ ] Popover contents:
  - [ ] Drag-reorderable list with per-range toggle
  - [ ] Custom range text input + Add button (validates against shared zod schema from 158A)
  - [ ] Save / Reset — Reset = `PATCH /user-preferences { dashboard_performance_ranges: null }` (no confirm)
- [ ] Mobile entry: new "Display Preferences" section in profile/account drawer. Same popover logic.
- [ ] User ranges are authoritative when present; admin defaults only apply when user pref is absent. Surfaced via `source` field from effective-ranges endpoint
- [ ] Testids: `timeframe-pill-{range}`, `timeframe-gear-btn`, `timeframe-popover-trigger`, `timeframe-toggle-{range}`, `timeframe-custom-input`, `timeframe-add-btn`, `timeframe-save-btn`, `timeframe-reset-btn`

### F5 — Card reorder (dnd-kit)

- [ ] Create `apps/web/components/dashboard/cards.ts` — `const DASHBOARD_CARDS: readonly CardSpec[]` with `{ slug, fullWidth, Component }`. Kebab-case slugs: `portfolio-trend`, `allocation-snapshot`, `return-percent`, `holdings-table`, `dividends-section`
- [ ] **Refactor `AppShell.tsx:1001-1114`** dashboard section — collapse three nested grids (`1.22fr/0.78fr`, `1fr`, `1.08fr/0.92fr`) into a single flat `<SortableContext>` wrapping DASHBOARD_CARDS
- [ ] Grid layout: `grid-cols-1 xl:grid-cols-2 gap-6` with `[grid-auto-flow:dense]`
- [ ] `HoldingsTable` and `DividendsSection` marked `fullWidth: true` (static per-card prop, not user-configurable) → render with `xl:col-span-2`
- [ ] `RouteHeroPanel` and `ActionCenterSection` stay outside the SortableContext, unchanged (fixed cards)
- [ ] **Portfolio page dropped from F5 scope** — only one draggable card there, no user value. Drop `AddTransactionCard` and `StatusStripCard` "fixed" designations since there are no draggables to contrast with
- [ ] **Interaction**:
  - Desktop: `⠿` drag handle top-left of each draggable card header
  - Mobile: `TouchSensor` with long-press delay → toast "Card selected — drag to reorder"
- [ ] **Render-time merge**: canonical DASHBOARD_CARDS + `user_preferences.preferences.card_order.dashboard` → displayed order. Unknown slugs dropped silently; new canonical slugs appended at end. No migration when cards are added or removed.
- [ ] **Persistence**: `PATCH /user-preferences { card_order: { dashboard: [...slugs] } }` debounced 250 ms after `onDragEnd`
- [ ] **Optimistic UI**: snapshot previous `card_order` before applying drag; restore on PATCH failure with error toast
- [ ] **Reset layout** button in profile/account drawer `Layout` subsection → `PATCH /user-preferences { card_order: null }` (no confirm)
- [ ] Testids: `drag-handle-{card-slug}`, `{card-slug}` on each card root, `reset-layout-btn`

### Tests (158C)

- [ ] **Desktop-only E2E** via `locator.dragTo(target)` on testids. Assert by `GET /user-preferences` state read-back, not DOM order
- [ ] **Mobile TouchSensor + long-press toast**: manual verification only, **no E2E**. Document as known gap
- [ ] Run `/aaa` to produce 2 AAA specs: `dashboard-timeframe-aaa.spec.ts`, `card-reorder-aaa.spec.ts`
- [ ] **Pre-PR:** `/code-reviewer` → fix → full 8-suite gate

---

## Open Items / Deferred Future Work

- **Mobile TouchSensor + long-press toast E2E coverage** — requires a new `playwright.mobile.config.ts` with device emulation. Not scoped in 158C.
- **Admin-controlled card order** — explicitly out of scope per Q6. Users control card order; admin controls only timeframe ranges.
- **Range grammar extensions** — weeks (`W`), days (`D`), quarters (`QTD`), anchored (`SINCE-YYYY-MM-DD`). Explicitly out of scope per Q2.

---

## References

- **Linear umbrella:** KZO-158 — https://linear.app/kzokv/issue/KZO-158/
- **Sub-tickets:**
  - KZO-159 (158A) — https://linear.app/kzokv/issue/KZO-159/
  - KZO-160 (158B) — https://linear.app/kzokv/issue/KZO-160/
  - KZO-161 (158C) — https://linear.app/kzokv/issue/KZO-161/ (blocked by KZO-159)
- **Mockups (required reading):** `kzo-158-ui-mockups.png` (repo root, uncommitted) + `.worklog/kzo-158-ui-mockups.html` (ephemeral)
- **Rules referenced during scope-lock:** `fastify-eviction-lifecycle-pattern.md`, `nextjs-i18n-serialization.md`, `service-error-pattern.md`, `migration-strategy.md`, `integration-test-persistence-direct.md`, `e2e-seed-vs-reset-guards.md`, `full-test-suite.md`, `admin-new-subpage-checklist.md` (N/A — new section, not subpage), `test-framework-scope-estimation.md`, `agent-team-workflow.md`
