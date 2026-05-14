# Code Review — Phase 3 iter 4 delta (ui-enhancement)

**Date**: 2026-05-14T07:45:00Z  
**Reviewer**: Code Reviewer (Tier 3, Claude Sonnet)  
**Branch**: `worktree-ui-enhancement`  
**Activation**: Explicit `[ARCHITECT:GO]` envelope, iter-4 delta scope

---

## Scope

Delta-only over iter-3 baseline. Iter-3 surface cleared by prior CR + Codex pass.

**Iter-4 checklist (6 items, per Architect brief):**

1. BE HIGH-1a — `getSnapshotGenerationInputs` no-scope fix + dividend `divFilter` consistency on both scope branches
2. BE HIGH-1b — `getAggregatedSnapshotsInReportingCurrency` filter
3. BE HIGH-2 — `getCashLedgerEntriesForWalletReplay` fix + sibling audit
4. BE MEDIUM-1 — `registerRoutes.ts:3127` intentional comment citing scope-grill Q4
5. QA regression guards — 2 new guards in `accountSoftDeleteReadFilter.integration.test.ts`
6. Holistic hide-everywhere audit grep (all 9 account-scoped tables, all read paths)

---

## Verdict: FIX-REQUIRED

**2 new findings** from holistic audit (1 HIGH, 1 MEDIUM).  
All 5 delta items (iter-3 fixes + QA guards) verified CLEAN.

---

## NEW HIGH Finding

### HIGH-1 — P1-2: `getMonitoredSet` reads `lots` without soft-delete filter (user-facing)

**Severity**: HIGH  
**File**: `apps/api/src/persistence/postgres.ts` lines 6785–6851 (`getMonitoredSet`)  
**Route callers**: `registerRoutes.ts:4571` (GET /monitored-tickers), `registerRoutes.ts:4621` (POST /monitored-tickers)

**Description**:

The `positions` CTE inside `getMonitoredSet` reads:

```sql
FROM lots l
JOIN accounts a ON l.account_id = a.id
WHERE a.user_id = $1 AND l.open_quantity > 0
```

There is no `AND a.deleted_at IS NULL` predicate. After an account is soft-deleted:
- The account's lots remain in the `lots` table (soft-delete only sets `accounts.deleted_at`)
- `getMonitoredSet` still derives position-based monitored tickers from those lots
- `GET /monitored-tickers` therefore returns tickers from soft-deleted accounts
- The user's monitored ticker list (visible in the UI watchlist) includes tickers whose underlying positions are hidden in every other portfolio view

This violates the P1-2 "hide-everywhere" invariant for the `lots` table: lots is one of the 9 account-scoped tables in scope, and this is a user-facing read path (two route call sites confirmed) with no soft-delete filter.

**No justification comment** was found at the `positions` CTE explaining why the unfiltered read is intentional.

**Fix required**:

Add `AND a.deleted_at IS NULL` to the `positions` CTE's WHERE clause:

```sql
FROM lots l
JOIN accounts a ON l.account_id = a.id
WHERE a.user_id = $1
  AND a.deleted_at IS NULL   -- ui-enhancement P1-2: exclude soft-deleted accounts' lots [active-only filter ADDED]
  AND l.open_quantity > 0
```

---

## NEW MEDIUM Finding

### MEDIUM-1 — P1-2: `listDividendLedgerYears` reads `dividend_ledger_entries` without soft-delete filter

**Severity**: MEDIUM  
**File**: `apps/api/src/persistence/postgres.ts` lines 4662–4684 (`listDividendLedgerYears`)  
**Route caller**: `registerRoutes.ts:3950`

**Description**:

`listDividendLedgerYears` aggregates distinct dividend years:

```sql
FROM dividend_ledger_entries AS dle
JOIN accounts AS account ON account.id = dle.account_id
JOIN market_data.dividend_events AS event ON event.id = dle.dividend_event_id
WHERE account.user_id = $1
  AND event.payment_date IS NOT NULL
  AND dle.superseded_at IS NULL
  AND dle.reversal_of_dividend_ledger_entry_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM dividend_ledger_entries AS reversal
                  WHERE reversal.reversal_of_dividend_ledger_entry_id = dle.id)
```

No `AND account.deleted_at IS NULL`. After an account is soft-deleted, years populated solely by that account's dividend entries still appear in the year filter dropdown in the dividend reconciliation UI.

**Mitigating factor**: The main data query `listDividendLedgerEntries` (lines 4347–4374) DOES carry `AND account.deleted_at IS NULL -- ui-enhancement: [active-only filter ADDED]`. So clicking a ghost year returns 0 results — no actual dividend data is exposed. This is a UX inconsistency rather than a true data exposure.

**Severity rationale**: MEDIUM (not HIGH) because: (1) no sensitive financial data is exposed in the ghost year, (2) the impact is limited to a spurious year appearing in a filter dropdown, (3) the root data path is already correctly filtered.

**Fix required**:

Add `AND account.deleted_at IS NULL` to the WHERE clause:

```sql
WHERE account.user_id = $1
  AND account.deleted_at IS NULL  -- ui-enhancement P1-2: exclude soft-deleted accounts [active-only filter ADDED]
  AND event.payment_date IS NOT NULL
  ...
```

---

## CLEAN Items (iter-4 delta)

### Item 1 — HIGH-1a: `getSnapshotGenerationInputs` no-scope fix + divFilter consistency

**File**: `apps/api/src/persistence/postgres.ts` lines 2757–2821

**Trade filter** (no-scope path, line 2767–2769):
```ts
const tradeFilter = scope
  ? "user_id = $1 AND account_id = $2 AND ticker = $3"
  : "user_id = $1 AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)";
```
`[active-only filter ADDED]` comment present at lines 2761–2766 ✓

**Dividend filter** (both branches, lines 2793–2795):
```ts
const divFilter = scope
  ? "account.user_id = $1 AND account.deleted_at IS NULL AND dle.account_id = $2 AND de.ticker = $3"
  : "account.user_id = $1 AND account.deleted_at IS NULL";
```
Both the scoped and no-scope branches include `account.deleted_at IS NULL`. No asymmetry. `[active-only filter ADDED]` comment at line 2792 ✓

**CLEAN.**

---

### Item 2 — HIGH-1b: `getAggregatedSnapshotsInReportingCurrency` fix

**File**: `apps/api/src/persistence/postgres.ts` lines 2985–3089

WHERE clause (lines 3038–3043):
```sql
WHERE s.user_id = $1
  -- ui-enhancement — hide soft-deleted accounts' snapshot rows from the
  -- aggregator. [active-only filter ADDED]
  AND s.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
  AND s.snapshot_date >= $2::date
  AND s.snapshot_date <= $3::date
```
Single WHERE clause, no sub-queries that bypass the filter. `[active-only filter ADDED]` comment ✓

**CLEAN.**

---

### Item 3 — HIGH-2: `getCashLedgerEntriesForWalletReplay` fix + sibling audit

**File**: `apps/api/src/persistence/postgres.ts` lines 2709–2755

WHERE clause (lines 2732–2740):
```sql
WHERE user_id = $1
  AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
  AND reversal_of_cash_ledger_entry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM cash_ledger_entries r
    WHERE r.user_id = c.user_id
      AND r.reversal_of_cash_ledger_entry_id = c.id
  )
```
Memory/Postgres divergence resolved. Comment at lines 2724–2727 explains the invariant. `[active-only filter ADDED]` ✓

**Sibling audit** (getCashLedger\*, replay\*, WalletGeneration\*):
- `getCashLedgerEntriesForWalletReplay` — FIXED ✓
- `getCashLedgerEntriesForBalances` (postgres.ts:3250) — reads `FROM cash_ledger_entries WHERE user_id = $1` without soft-delete filter, but has **zero callers** (no route or service call site found). No immediate risk. Not a P1-2 violation today; requires the filter before wiring to a route.
- `getAccountCashBalance` (postgres.ts:2690) — scoped by `(userId, accountId, currency)` triple; per-account single-record lookup, not a broad user view. Acceptable.
- No `replay*` or `WalletGeneration*` sibling functions with unfiltered broad reads found.

**CLEAN.** (sibling `getCashLedgerEntriesForBalances` noted as INFORMATIONAL below)

---

### Item 4 — MEDIUM-1: intentional comment at `registerRoutes.ts:3123–3126`

Comment present at lines 3123–3126:
```ts
// ui-enhancement scope-grill Q4 — typed-name "Permanently delete now"
// applies to active accounts too (skip-wait shortcut per Mockup C).
// `mustBeSoftDeleted: false` is INTENTIONAL — not a bug. The cron path
// separately calls hardPurgeAccount with `mustBeSoftDeleted: true`.
```

Comment explicitly:
- Names the scope-grill question (`Q4`)
- States the mockup reference (`Mockup C`)
- Flags the value as intentional with the rationale
- Contrasts with the cron path's safe default

**CLEAN.**

---

### Item 5 — QA regression guards (2 new tests)

**File**: `apps/api/test/integration/accountSoftDeleteReadFilter.integration.test.ts` lines 380–465

**Guard 1 — HIGH-1 (daily_holding_snapshots, lines 398–440)**:
- Dual-account pattern: `acc-snap-hidden` + `acc-snap-active` ✓
- Soft-deletes hidden account only ✓
- Calls `generateHoldingSnapshots(ownerUserId, persistence!)` (service function, not a persistence mock) ✓
- Asserts `hiddenSnapshotRows.length === 0` (0 rows for deleted account) ✓
- Asserts `activeSnapshotRows.length >= 1` (survivor's snapshots land) ✓
- Seeds a daily bar for the active ticker so the snapshot writer has price data — prevents false-negative where writer simply had nothing to write for either account ✓
- Uses `pool.query` directly for the assertion (unfiltered raw count) ✓
- `PostgresPersistence` direct (from `beforeEach`) ✓

**Guard 2 — HIGH-2 (currency_wallet_snapshots, lines 442–465)**:
- Dual-account pattern: `acc-wallet-hidden` + `acc-wallet-active` ✓
- Soft-deletes hidden account only ✓
- Calls `generateCurrencyWalletSnapshots(ownerUserId, persistence!)` (service function) ✓
- Asserts `hiddenWalletRows.length === 0` ✓
- Asserts `activeWalletRows.length >= 1` ✓
- `PostgresPersistence` direct ✓

**AAA discipline**: Assertions use direct SQL `pool.query` against the raw table — no persistence-layer filtering in the assertion path, so the test genuinely validates the filter was applied by the service layer rather than by the assertion query itself. ✓

**CLEAN.**

---

## Holistic Audit Results

Ran exhaustive grep:
```
grep -rnE "FROM (trade_events|cash_ledger_entries|lot_allocations|lots|recompute_jobs|
daily_holding_snapshots|daily_portfolio_snapshots|currency_wallet_snapshots|
dividend_ledger_entries|fee_profiles|account_fee_profile_overrides|corporate_actions)"
apps/api/src/
```

**Classification of every match:**

| Path | Lines | Verdict |
|---|---|---|
| `loadStore` Batch 1 (trade_events, lot_allocations, recompute_jobs, cash_ledger_entries, fee_profiles) | 1764–1821 | CLEAN — `account_id IN (SELECT id FROM accounts WHERE user_id=$1 AND deleted_at IS NULL)` subquery on all, `[active-only filter ADDED]` ✓ |
| `loadStore` Batch 2 (account_fee_profile_overrides, lots, corporate_actions, dividend_ledger_entries) | 1875–1907 | CLEAN — keyed by `accountIds` array derived from active-only accounts in Batch 1 ✓ |
| `saveStore` DELETEs (all tables) | 2344–2383 | Write paths only — N/A for read filter invariant |
| `getAccountCashBalance` (cash_ledger_entries) | 2690–2706 | Scoped to `(userId, accountId, currency)` — targeted lookup, not a broad user view |
| `getCashLedgerEntriesForWalletReplay` (cash_ledger_entries) | 2731–2740 | CLEAN — iter-4 fix applied ✓ |
| `getSnapshotGenerationInputs` (trade_events, dividend_ledger_entries, cash_ledger_entries) | 2779–2810 | CLEAN — iter-4 fix applied to no-scope path ✓; cash_ledger_entries sub-query for dividend receipts is contained within the outer JOIN that already filters `account.deleted_at IS NULL` |
| `getAggregatedSnapshots` legacy (daily_holding_snapshots) | 2950 | INFORMATIONAL — zero callers outside persistence layer. Dead code. Not currently user-facing. |
| `getAggregatedSnapshotsInReportingCurrency` (daily_holding_snapshots) | 3030 | CLEAN — iter-4 fix applied ✓ |
| `countHoldingSnapshotsAfterDate` (daily_holding_snapshots) | 3093 | Scoped by `(userId, accountId, ticker)` — internal recompute helper, not a broad user view |
| `getHoldingSnapshotsForTicker` (daily_holding_snapshots) | 3116 | Scoped by `(userId, accountId, ticker)` — internal recompute helper |
| `deleteAllCurrencyWalletSnapshots` (currency_wallet_snapshots) | 3205 | Delete path — N/A |
| `getCurrencyWalletSnapshotsForAccount` (currency_wallet_snapshots) | 3229 | Scoped by `(userId, accountId)` — no callers outside persistence layer; dead code |
| `getCashLedgerEntriesForBalances` (cash_ledger_entries) | 3260 | INFORMATIONAL — reads all user's entries without filter; zero callers. See sibling audit note above. |
| `applyDividendLedgerEntry` ownership check (dividend_ledger_entries) | 3582 | Single-row lookup by primary key for write path — N/A |
| `recordDividendSourceLines` ownership check (dividend_ledger_entries) | 3774 | Single-row lookup by primary key + userId for write path — N/A |
| `getDividendLedgerEntry` (dividend_ledger_entries) | 3827–3832 | Scoped by `dle.id` + `account.user_id` — targeted single-record lookup |
| `recomputeDividendLedgerEntry` paths (dividend_ledger_entries) | 3924–3929 | Scoped to specific `(account, ticker)` — internal recompute, not a broad user view |
| `planDividendLedgerRecompute` (dividend_ledger_entries) | 3989 | Scoped to specific `(account, ticker)` — internal recompute |
| `listDividendLedgerEntries` (dividend_ledger_entries) | 4347 | CLEAN — `AND account.deleted_at IS NULL [active-only filter ADDED]` present ✓ |
| `listDividendLedgerEntries` (cash_ledger_entries subquery) | 4355 | Contained in the outer JOIN that already filters `account.deleted_at IS NULL` |
| `listDividendLedgerYears` (dividend_ledger_entries) | 4666 | **NEW MEDIUM** — missing `AND account.deleted_at IS NULL` (see above) |
| `listCashLedgerEntries` (cash_ledger_entries) | 4590–4607 | CLEAN — `AND account_id IN (SELECT id FROM accounts WHERE user_id=$1 AND deleted_at IS NULL)` + `[active-only filter ADDED]` ✓ |
| Hard-purge cascade DELETEs | 5228–7603 | Delete paths scoped to specific accountId/userId — N/A |
| `getTradeEventWithFees` (trade_events) | 5487 | Scoped by `te.id + te.user_id` — single-record lookup |
| `updateTradeEvent` sequence helpers (trade_events) | 5631–5644 | Write paths (UPDATE) — N/A |
| `getTradeEventsForAccountTicker` (trade_events) | 5680 | Scoped by `(userId, accountId, ticker)` — recompute/replay, not a broad user view |
| `compactBookingSequence` (trade_events) | 5869 | Write path (UPDATE) — N/A |
| `getMonitoredSet` (lots) | 6822 | **NEW HIGH** — missing `AND a.deleted_at IS NULL` (see above) |
| `getAllMonitoredTickers` (lots, trade_events) | 6868–6874 | System-internal cron function for refresh dispatch; no userId scope — not a user-facing portfolio view |
| `getUsersMonitoringTicker` (lots) | 6918 | System-internal cron; no userId scope — not a user-facing portfolio view |
| `demoCleanup.ts` (all tables) | 17–34 | Admin-only hard-delete utility for demo user teardown — N/A |

---

## Summary Table

| # | Item | Severity | Status |
|---|---|---|---------|
| A | BE HIGH-1a fix: getSnapshotGenerationInputs + divFilter both branches | — | CLEAN |
| B | BE HIGH-1b fix: getAggregatedSnapshotsInReportingCurrency | — | CLEAN |
| C | BE HIGH-2 fix: getCashLedgerEntriesForWalletReplay | — | CLEAN |
| D | BE MEDIUM-1 intentional comment citing scope-grill Q4 | — | CLEAN |
| E | QA Guard 1: daily_holding_snapshots not written for soft-deleted accounts | — | CLEAN |
| F | QA Guard 2: currency_wallet_snapshots not written for soft-deleted accounts | — | CLEAN |
| G | Holistic audit: getMonitoredSet reads lots without deleted_at filter | HIGH | **FIX REQUIRED** |
| H | Holistic audit: listDividendLedgerYears reads dividend_ledger_entries without deleted_at filter | MEDIUM | **FIX REQUIRED** |
| I | INFORMATIONAL: getAggregatedSnapshots (legacy, no callers) | INFO | Note only |
| J | INFORMATIONAL: getCashLedgerEntriesForBalances (no callers) | INFO | Note only |

**Total new findings**: 1 HIGH, 1 MEDIUM, 2 INFORMATIONAL.

---

## Fix Guidance

### HIGH-1 fix — `getMonitoredSet` lots filter

`apps/api/src/persistence/postgres.ts` — the `positions` CTE inside `getMonitoredSet`:

```sql
-- Current (missing filter):
FROM lots l
JOIN accounts a ON l.account_id = a.id
WHERE a.user_id = $1 AND l.open_quantity > 0

-- Fixed:
FROM lots l
JOIN accounts a ON l.account_id = a.id
WHERE a.user_id = $1
  AND a.deleted_at IS NULL   -- ui-enhancement P1-2: exclude soft-deleted accounts' lots [active-only filter ADDED]
  AND l.open_quantity > 0
```

No route changes needed.

### MEDIUM-1 fix — `listDividendLedgerYears` filter

`apps/api/src/persistence/postgres.ts` — `listDividendLedgerYears`:

```sql
-- Current:
WHERE account.user_id = $1
  AND event.payment_date IS NOT NULL
  ...

-- Fixed:
WHERE account.user_id = $1
  AND account.deleted_at IS NULL   -- ui-enhancement P1-2: exclude soft-deleted accounts [active-only filter ADDED]
  AND event.payment_date IS NOT NULL
  ...
```

### Memory backend parity

After fixing postgres.ts, verify the memory backend's equivalent methods also filter correctly:
- `memory.ts getMonitoredSet` delegates to `loadStore(userId)` which already filters `deleted_at IS NULL` ✓ (inferred from iter-3 CLEAN verdict on loadStore — the lots in Batch 2 are derived from the active-only `accountIds` array)
- `memory.ts listDividendLedgerYears` — verify it also reads only from active accounts' dividend entries (likely via `loadStore`-derived dividend data)
