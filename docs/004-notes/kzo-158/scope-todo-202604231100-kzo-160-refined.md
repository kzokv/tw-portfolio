---
slug: kzo-160
source: scope-grill
created: 2026-04-23
tickets: [KZO-160]
required_reading:
  - kzo-158-ui-mockups.png
  - docs/004-notes/kzo-158/scope-todo-202604221500-initial.md
superseded_by: null
---

# Todo: KZO-160 — Transaction Form Polish (F1 + F2 + F3)

> **For agents starting a fresh session:** read all files in `required_reading` before starting. This todo supersedes the KZO-158B section of `scope-todo-202604221500-initial.md` — use this file as the authoritative source for KZO-160. Seven scope decisions were refined in a second grill session on 2026-04-23; deltas from the original are marked ⚡.

---

## Implementation Steps

### F1 — Account display + inline rename

- [ ] **`PATCH /accounts/:id`** at `registerRoutes.ts:2315` — make `feeProfileId` optional; add `.refine(v => v.name !== undefined || v.feeProfileId !== undefined, "at least one field required")`. ⚡ Guard `requireProfile(store, body.feeProfileId)` and the `account.feeProfileId` assignment behind a `body.feeProfileId !== undefined` check — the current code calls `requireProfile` unconditionally which would throw on name-only patches.

- [ ] **`AccountDto` — no change.** ⚡ `feeProfileName` is NOT added to `AccountDto` or `GET /accounts`. Client-side derivation only (see below).

- [ ] **`AddTransactionCard.tsx`** — extend `accountOptions` prop type from `Array<{ id: string; name: string }>` to `Array<{ id: string; name: string; feeProfileName: string }>`. Render each option as `{name} — {feeProfileName}`. ⚡ The parent component already loads fee profiles; extend the `accountOptions` mapping with a `.find()` cross-reference against the loaded profiles — no new fetch needed.

- [ ] Add `data-testid="account-selector"` to the wrapping `<label>` element in `AddTransactionCard.tsx`. ⚡ Keep existing `data-testid="tx-account-select"` on the `<select>` (sibling E2E specs reference it).

- [ ] **`AccountFallbackSection.tsx`** — add pencil icon (`✏️` or lucide `Pencil`) next to account name → toggle inline `<input>` + Save/Cancel buttons.
  - Save disabled when name is empty (client-side guard)
  - Save: calls `PATCH /accounts/:id` with `{ name }`; on success, updates local state
  - Cancel: restores original name, no API call
  - Add `onRenameAccount: (accountId: string, name: string) => void` prop; parent implements via `PATCH /accounts/:id`
  - Testids: `account-name-label`, `account-rename-icon`, `account-name-input`, `account-rename-save`, `account-rename-cancel`

---

### F2 — Unit price pre-fill

- [ ] **New route `GET /market-data/price`** — query params `ticker` (string) and `date` (ISO date). Place at `registerRoutes.ts` alongside existing market-data routes.

- [ ] **Validation:** reject future dates with 400 `invalid_date`. Use `isoDateSchema` already defined in `registerRoutes.ts`.

- [ ] **Lookup chain (service layer — no new persistence method needed):** ⚡
  1. Call `getDailyBarsForTicker(ticker, sevenDaysBack, requestedDate)` (7-day window ending on `requestedDate`).
  2. If a bar exists where `bar.date === requestedDate` → return `{ close, date, source: bar.source, match: "exact" }` → 200.
  3. Else if any bars exist → take the most recent → return `{ close, date, source, match: "previous", reason: requestedDate falls on weekend ? "weekend" : "no_bar" }` → 200. ⚡ `"holiday"` is dropped — no TW market calendar exists.
  4. Else → call FinMind `fetchDailyBars(ticker, sevenDaysBack, requestedDate)`. On hit → opportunistic upsert into `daily_bars` with `source: 'finmind'`, then return `{ close, date, source: "finmind", match: "previous", reason: ... }` → 200.
  5. Nothing anywhere → `{ error: "price_not_found" }` → 404.

- [ ] **Rate limiter** — new file `apps/api/src/lib/marketDataPriceRateLimit.ts`. ⚡ Per-IP (not per-user), 30 req/min sliding window. Follow the canonical `registerXEviction(app)` factory pattern from `fastify-eviction-lifecycle-pattern.md`. Assert signature: `assertMarketDataPriceRateLimit(ip: string)`. Export `_resetMarketDataPriceBuckets()` for test isolation. Call `registerMarketDataPriceEviction(app)` from `registerRoutes.ts` before route handlers.

- [ ] 429 on rate-limit breach; UI renders same red "unavailable" hint as a 404.

- [ ] ⚡ **FinMind coordination:** independent — do NOT coordinate with the backfill worker's FinMind rate limiter (`apps/api/src/services/market-data/rateLimiter.ts`). FinMind 429s on the price endpoint surface as 404 `price_not_found`.

- [ ] **i18n keys** (string templates only — no functions, per `nextjs-i18n-serialization.md`):
  - `dict.priceHint.exact`
  - `dict.priceHint.previous.weekend`
  - `dict.priceHint.previous.no_bar` ⚡ (`previous.holiday` dropped)
  - `dict.priceHint.unavailable`

- [ ] Testids: `unit-price-input`, `price-source-hint`, `price-unavailable-hint`

---

### F3 — Fee estimate

- [ ] **New route `POST /portfolio/transactions/estimate`** ⚡ (not `/transactions/estimate` — must be under the `/portfolio/` namespace consistent with all transaction routes). Body: `{ ticker, quantity, unitPrice, type, isDayTrade, accountId }`.

- [ ] **Handler flow:**
  1. Load user store.
  2. Find account by `accountId` → 404 `account_not_found` if missing.
  3. Resolve effective fee profile: check `store.feeProfileBindings` for a `(accountId, ticker)` override; fall back to `account.feeProfileId`. Load the `FeeProfile` object.
  4. ⚡ `tradeCurrency = profile.commissionCurrency ?? "TWD"` — read from the resolved fee profile, not hardcoded.
  5. ⚡ `instrumentType` — call `app.persistence.getInstrument(ticker)`. If found and classified (non-null type), use it. Otherwise default to `"STOCK"`.
  6. Compute: BUY → `calculateBuyFees(profile, quantity * unitPrice, tradeCurrency)`. SELL → `calculateSellFees(profile, { tradeValueAmount: quantity * unitPrice, tradeCurrency, instrumentType, isDayTrade, marketCode: "TW" })`.
  7. Return `{ commissionAmount, taxAmount }`.

- [ ] **Commission section** (BUY + SELL): `Estimated: NT$X` read-only display + optional `Override` text input.
- [ ] **Securities Tax section** (SELL only — hidden for BUY): same pattern.
- [ ] Submit: empty override → omit field (server uses its own fee calc); filled override → value sent verbatim.
- [ ] All errors use `routeError(status, code, message)` per `service-error-pattern.md`.
- [ ] Testids: `commission-estimate-section`, `commission-estimate-value`, `commission-override-input`, `tax-estimate-section`, `tax-estimate-value`, `tax-override-input`

---

### F2 + F3 — Shared debounce chain

- [ ] Single coalesced `useEffect` watching `[ticker, tradeDate, type, isDayTrade, quantity, unitPrice, accountId]`, 400 ms debounce.

- [ ] `hasUserEditedUnitPrice` ref (boolean, starts `false`):
  - Set to `true` only in the `onChange` handler of the `unit-price-input` field (user typed manually).
  - Reset to `false` when `ticker` or `tradeDate` changes.
  - Auto-fill from F2 writes to `unitPrice` state directly — does NOT set this flag.

- [ ] Sequential execution within the effect:
  1. If (`ticker` or `tradeDate` changed) AND `!hasUserEditedUnitPrice`: fetch `GET /market-data/price?ticker&date`. On success, write `unitPrice` to form state (triggers effect re-run but flag is false so price fetch is skipped next time). On failure, show unavailable hint; do not fetch estimate.
  2. If `unitPrice > 0 && quantity > 0 && accountId`: fetch `POST /portfolio/transactions/estimate`. On success, write fee display state. On failure, clear fee display.

- [ ] `AbortController` per effect invocation; abort prior in-flight on re-fire.

- [ ] In-memory `Map<"ticker|date", { close, date, source }>` cache, 60 s TTL. Cache key: `${ticker}|${date}`.

---

### Tests

- [ ] Run `/aaa` to produce 3 AAA E2E specs: ⚡ all in `apps/web/tests/e2e/specs/` (dev_bypass suite, not `specs-oauth/`):
  - `account-display-aaa.spec.ts`
  - `transaction-price-prefill-aaa.spec.ts`
  - `transaction-fee-estimate-aaa.spec.ts`

- [ ] **Pre-PR:** `/code-reviewer` → fix findings → full 8-suite gate:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```

---

## Open Items

None. All gaps resolved in the 2026-04-23 grill session.

---

## References

- **Linear:** KZO-160 — https://linear.app/kzokv/issue/KZO-160/
- **Parent scope-todo (superseded for KZO-160 section):** `docs/004-notes/kzo-158/scope-todo-202604221500-initial.md`
- **Mockups:** `kzo-158-ui-mockups.png` (repo root) + `.worklog/kzo-158-ui-mockups.html` (ephemeral)
- **Rules:** `fastify-eviction-lifecycle-pattern.md`, `nextjs-i18n-serialization.md`, `service-error-pattern.md`, `integration-test-persistence-direct.md`, `e2e-seed-vs-reset-guards.md`, `full-test-suite.md`
