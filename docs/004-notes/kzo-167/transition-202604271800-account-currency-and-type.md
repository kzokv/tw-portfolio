---
slug: kzo-167
type: transition
created: 2026-04-27T18:00Z
tickets: [KZO-167]
superseded_by: null
---

# Transition note: KZO-167 — Account model: `default_currency` + `account_type` enum

> **Frozen.** This note records what was true at merge time. Do not update in place.

---

## Context

KZO-167 completes the account-model foundation that KZO-165 (multi-currency snapshot schema) and KZO-166 (WAC engine + realized FX P&L) required but deferred. It ships:

1. **Schema additions** — `accounts.default_currency CHAR(3)` and `accounts.account_type TEXT` with CHECK constraints.
2. **Type merge** — `AccountDto` in `@tw-portfolio/shared-types` gains both fields; the legacy `interface Account` in `apps/api/src/types/store.ts` is removed.
3. **Service guard** — `apps/api/src/services/cashLedgerService.ts` (new module) enforces the cash-entry currency invariant on emission paths 1–3, and consolidates `buildTradeSettlementCashEntry` from its former duplicated locations in `portfolio.ts` and `recompute.ts`.
4. **PATCH lockdown** — `PATCH /accounts/:id` now accepts `defaultCurrency` and `accountType`; currency changes are blocked once the account has any cash entries or trade events.
5. **`/cash-ledger` UI chip** — account dropdown options and per-account summary chips render `Name (TWD · Broker)` format.

This ticket unblocks KZO-170 (US-market broker accounts), KZO-171 (AU-market), KZO-179 (multi-account creation form), and KZO-180 (user-level reporting currency consumer).

**Sibling tickets explicitly out of scope:** KZO-179 (multi-account creation form, `POST /accounts`), KZO-180 (user-level reporting currency consumer: `user_preferences.reportingCurrency` JSONB key + dashboard FX-aware reads + settings UI), and KZO-181 (`FeeProfile`/`FeeProfileBinding` mirror cleanup). None of these ship in this ticket.

---

## Behavioral changes

### Cash-entry currency guard (new — emission paths 1, 2, 3)

The new `assertCashEntryCurrencyMatchesAccount(entry, account)` function is called before every cash-ledger write on the three live emission paths:

| Path | Location | Wrapper |
|---|---|---|
| 1 — initial trade booking | `portfolio.ts:120` | `bookCashLedgerEntry(store, entry)` |
| 2 — dividend posting | `dividends.ts:610-655` | inline assert inside `buildDividendCashLedgerEntries` |
| 3 — fee-profile recompute | `recompute.ts:84` | `bookTradeSettlementRecompute(store, tx)` |

A mismatch produces:

```
400 currency_mismatch
"Cash entry currency ... does not match account default currency ..."
```

> **Was previously:** silently accepted on all paths (no per-account currency column existed).

### Path 4 explicitly skipped (invariant continuation)

`replayPositionHistory.ts:161` (`bulkInsertCashLedgerEntries` in the full replay) is **not** wrapped by the guard. Replay re-derives entries from already-validated `trade_events`. Combined with the PATCH lockdown below, no source-data drift can introduce a currency mismatch on the replay path. This is an explicit continuation of the invariants documented in `replay-position-history-invariants.md`. A doc comment near the `bulkInsertCashLedgerEntries` call in `replayPositionHistory.ts` records this decision.

### PATCH `/accounts/:id` currency-change lockdown (new)

When `body.defaultCurrency` is provided and differs from the account's current value, the handler checks whether any `cash_ledger_entries` or `trade_events` rows exist for the account. If either exists, the change is refused:

```
409 currency_change_blocked
"Cannot change default currency: account has existing cash entries or trade events. Open a new account or contact support."
```

> **Was previously:** `PATCH /accounts/:id` accepted only `name` and `feeProfileId`; `defaultCurrency` and `accountType` were not route-schema fields at all.

`accountType` changes are **unguarded** — direct assignment and persist. See "No-ops" below.

---

## Migrations

**Migration 040** (`db/migrations/040_kzo167_account_currency_and_type.sql`):

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_currency CHAR(3) NOT NULL DEFAULT 'TWD';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'broker';
-- CHECK constraints via DO $$ guards (mirrors 039 pattern):
-- ck_accounts_default_currency  CHECK (default_currency IN ('TWD','USD','AUD'))
-- ck_accounts_account_type      CHECK (account_type IN ('broker','bank','wallet'))
```

Idempotent. Postgres backfills existing rows to `'TWD'`/`'broker'` automatically via `DEFAULT` on `ADD COLUMN` — no explicit UPDATE required. The `DO $$` constraint guards mirror the pattern in `db/migrations/039_kzo166_cash_ledger_fx_rate.sql`.

---

## Renamed / removed types

| Removed | Added | Notes |
|---|---|---|
| `interface Account` (`apps/api/src/types/store.ts`) | `AccountDto` (`@tw-portfolio/shared-types`) | `Store.accounts: Account[]` → `AccountDto[]`. Import is type-only; no runtime change. |
| _(none)_ | `AccountDefaultCurrency` | New type-only union `"TWD" \| "USD" \| "AUD"` in `libs/shared-types/src/index.ts`. |
| _(none)_ | `AccountType` | New type-only union `"broker" \| "bank" \| "wallet"` in `libs/shared-types/src/index.ts`. |

`FeeProfile` and `FeeProfileBinding` mirror divergences (`taxRules?` and `marketCode?`) are **not** touched — real divergence left for KZO-181.

---

## No-ops (nothing changed despite appearances)

- **`appendCashLedgerEntry`** — still exported from `apps/api/src/services/accountingStore.ts` as a documented test-only/internal backdoor. The new wrappers delegate to it; tests may continue to call it directly for synthetic seeding.
- **`replayPositionHistory.ts`** — unmodified. Path 4 skip is recorded with a doc comment near `bulkInsertCashLedgerEntries` referencing this scope-todo and `replay-position-history-invariants.md`.
- **`account_type` behavioral gating** — `'broker'`, `'bank'`, and `'wallet'` accounts accept the same entry types and trade events as before. The field is metadata only in this ticket; behavioral semantics land in downstream tickets (KZO-168 `FX_TRANSFER`, KZO-170/171 US/AU markets).
- **Auto-seeded "Main" account** — `ensureDefaultPortfolioData` now hard-codes `default_currency = 'TWD'`, `account_type = 'broker'`. Existing single-account installs are unaffected.

---

## Forward links

| Ticket | Blocked on KZO-167? | What it adds |
|---|---|---|
| **KZO-179** | Yes | Multi-account creation form, `POST /accounts`, account-creation audit log |
| **KZO-180** | Yes (+ KZO-176) | `user_preferences.reportingCurrency` JSONB key, dashboard/portfolio-summary FX-aware read consumers, settings UI |
| **KZO-181** | No | `FeeProfile`/`FeeProfileBinding` mirror divergence investigation and consolidation |
| **KZO-168** | No | `FX_TRANSFER` cash-entry type (producer side of `fx_rate_to_usd`) |
| **KZO-170 / KZO-171** | Yes | US / AU market broker account support |
