# Phase 3 Code Review — ui-enhancement Wave 1 (Iter 2 Delta)

**Reviewer:** code-reviewer (Sonnet, Tier 3)
**Date:** 2026-05-13T11:21 UTC
**Branch:** `worktree-ui-enhancement`
**Scope:** Delta review of Phase 4 changes since iter-1 CLEAN verdict (2026-05-13T19:30 UTC)
**Authorized by:** `[ARCHITECT:GO]` envelope (9-item targeted delta checklist)

---

## Verdict: CLEAN

All 9 delta checklist items pass. No HIGH or CRITICAL findings. Zero FIX-REQUIRED items.

---

## Checklist Results

### 1. Migration 055 constraint completeness — CLEAN ✓

`db/migrations/055_uie_audit_log_account_actions.sql`:
- Uses `DROP CONSTRAINT IF EXISTS audit_log_action_check` + `ADD CONSTRAINT audit_log_action_check` — same name, correct `IF EXISTS` guard.
- All 29 legacy actions from migration 049 (`admin_promote_cli` … `instrument_absence_guard_tripped`) preserved verbatim.
- 3 new actions added: `account_soft_deleted`, `account_restored`, `account_hard_purged`.
- Constraint name is consistent with `AuditLogAction` in `apps/api/src/persistence/types.ts` (lines 212–214). ✓

No existing action dropped. Migration is purely additive. ✓

---

### 2. Index-rename test updates — CLEAN ✓

`apps/api/test/integration/postgres-migrations.integration.test.ts` (line 2899):
- Asserts `ux_accounts_user_id_name_active` (new partial index name after migration 053).
- Line 2908: `expect(indexRow.rows[0].indexdef).toMatch(/deleted_at IS NULL/i)` confirms the partial predicate. ✓

`apps/api/test/integration/account-creation-uniqueness.integration.test.ts` (line 142):
- Test title updated to reference `ux_accounts_user_id_name_active` + partial predicate. ✓

Both integration tests correctly reference the post-053 index name; no stale `ux_accounts_user_id_name` references detected. ✓

---

### 3. Defensive fee_profiles fix (loadStore + saveStore) — CLEAN ✓

`apps/api/src/persistence/postgres.ts`:

**`loadStore` fee_profiles JOIN** (lines 1749–1769):
```sql
FROM fee_profiles fp
JOIN accounts a ON a.id = fp.account_id
WHERE a.user_id = $1 AND a.deleted_at IS NULL
ORDER BY fp.id
```
Comment explains the correctness rationale: filtering soft-deleted accounts' fee_profiles prevents `validateStoreInvariants` FK-orphan violations on the next `saveStore`. ✓

**`saveStore` Step 5 DELETE** (lines 2372–2383):
```sql
DELETE FROM fee_profiles
WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
  AND id <> ALL($2)
```
Comment documents: "PRESERVE fee profiles owned by soft-deleted accounts" — without this guard, the cleanup would hard-delete restored-account fee_profiles on every `saveStore`. ✓

Both guards are symmetric and self-consistent. The informational note from iter-1 CR (fee_profiles for soft-deleted accounts in `loadStore` intentional by design) is fully addressed. ✓

---

### 4. AAA spec no raw `expect()` — CLEAN ✓

`apps/web/tests/e2e/specs-oauth/account-deletion-aaa.spec.ts`:
- Zero raw `expect(` calls in spec body.
- Arrange-helper comment at lines 16–19 explicitly documents: "these are arrange-helpers, NOT assertions, so the AAA 'no raw expect()' rule does not apply." ✓
- All assertions route through `settings.assert.*` methods. ✓
- `mxAssertEqual` in the `[restore]` test routes through the base assistant helper (pre-existing framework method). ✓

---

### 5. Cluster F semantic rewrite + `priceCurrencyIs` retention — CLEAN ✓

`apps/web/components/portfolio/AddTransactionCard.tsx` (lines 192–246):
- Comment at lines 192–197 documents: "Previously (KZO-169) the dropdown was filtered to currency-compatible accounts (`chip → account`); that direction is now removed."
- `const dropdownAccounts = accountOptions;` — lists ALL accounts, no chip filter. ✓
- `useEffect` on `value.accountId`: sets `setExplicitChip(nextMarket)`, clears `ticker: ""`, reconciles `priceCurrency: currencyFor(nextMarket)`. ✓
- `handleChipChange` callback retained — user can still change chip independently. ✓

E2E specs (`au-backfill-aaa.spec.ts`, `us-backfill-aaa.spec.ts`, `transaction-form-market-code-aaa.spec.ts`, `account-market-binding-aaa.spec.ts`): all 4 have scope items 22–23 comments and retain `priceCurrencyIs` assertions. ✓

---

### 6. HTTP spec `body.error` check — CLEAN ✓

`apps/api/test/http/specs/transaction-currency-mismatch-aaa.http.spec.ts`:
- Line 59: `transactionsApi.assert.fieldEquals(body, "error", "currency_mismatch")` — reads `body.error`, not `body.code`. ✓
- Comment at lines 21–22: "body.error carries the code; body.message carries the human text." Documents compliance with `service-error-pattern.md`. ✓

---

### 7. `tx-ticker-input` → `tx-ticker-combobox` drift fix — CLEAN ✓

`libs/test-e2e/src/pages/shared/TransactionFormComponent.ts` (line 51):
```ts
tickerCombobox: this.locate("tx-ticker-combobox", "Ticker Combobox"),
```

`apps/web/components/portfolio/InstrumentCombobox.tsx` (line 308): `data-testid="tx-ticker-combobox"` — exact match. ✓

Full-repo grep (`grep -rn "tx-ticker-input"` scoped to `apps/`, `libs/`): zero live references. Any remaining occurrences are in `.next/` or `dist/` build artifacts only (excluded per stale-artifact rule). ✓

---

### 8. `insertRawAccount` fee_profile direct INSERT — CLEAN ✓

`apps/api/test/integration/accountHardPurgeCron.integration.test.ts` (lines 98–172):

`insertRawAccount` helper directly inserts a matching `fee_profiles` row per account (keyed `fp-${id}`), wrapped in a DEFERRABLE transaction. Comment at lines 101–105 explains:
> "Per migration 042 (KZO-183) fee_profiles is account-scoped — there is no `fee_profiles.user_id` column."

Full-repo grep for `fee_profiles.user_id` in active SQL: only appears in test description strings and comments, not in any SQL query. ✓

The helper correctly satisfies the composite FK `accounts.(fee_profile_id, id) REFERENCES fee_profiles(id, account_id)` by inserting fee_profile before COMMIT via DEFERRABLE transaction. ✓

---

### 9. Page-object additions — locator drift check — CLEAN ✓

Verified all new methods in 4 assistants against source `data-testid` attributes:

**TransactionsAssert** (11 new methods, `// ── ui-enhancement` section):
All access via `this.el.transactionForm.*` locators in `TransactionFormComponent.ts`. Each locator verified:

| Locator | Page-object string | Source testid | Match |
|---|---|---|---|
| `commissionEstimateSection` | `commission-estimate-section` | `AddTransactionCard.tsx:586` | ✓ |
| `commissionEstimateUnavailable` | `commission-estimate-unavailable` | `AddTransactionCard.tsx:600` | ✓ |
| `commissionOverrideInput` | `commission-override-input` | `AddTransactionCard.tsx:614` | ✓ |
| `taxEstimateSection` | `tax-estimate-section` | `AddTransactionCard.tsx:619` | ✓ |
| `marketChip(market)` | `tx-market-chip-${chip}` | `AddTransactionCard.tsx:350` | ✓ |
| `tickerCombobox` | `tx-ticker-combobox` | `InstrumentCombobox.tsx:308` | ✓ |

**TransactionsActions** (2 new methods):

| Method | Locator | Source testid | Match |
|---|---|---|---|
| `fillCommissionOverride` | `commission-override-input` | `AddTransactionCard.tsx:614` | ✓ |
| `fillTaxOverride` | `tax-override-input` | `AddTransactionCard.tsx:647` | ✓ |

**SettingsAssert** (15 new methods, `// ── ui-enhancement` section):
All access via `this.el.accountsList.*` locators in `SettingsDrawerPage.ts`. Each locator verified:

| Locator | Page-object string | Source testid | Match |
|---|---|---|---|
| `deleteButton(accountId)` | `account-delete-btn-${accountId}` | `AccountsListSection.tsx:630` | ✓ |
| `softDeleteModal` | `account-soft-delete-modal` | `AccountSoftDeleteModal.tsx:67` | ✓ |
| `softDeleteWarningLastAccount` | `account-soft-delete-warning-last-account` | `AccountSoftDeleteModal.tsx:92` | ✓ |
| `card(accountId)` | `accounts-card-${accountId}` | `AccountsListSection.tsx:537` | ✓ |
| `recentlyDeletedSection` | `recently-deleted-section` | `AccountsListSection.tsx:1104` | ✓ |
| `recentlyDeletedRow(accountId)` | `recently-deleted-row-${accountId}` | `AccountsListSection.tsx:1122` | ✓ |
| `recentlyDeletedRestoreButton(accountId)` | `recently-deleted-restore-btn-${accountId}` | `AccountsListSection.tsx:1143` | ✓ |
| `recentlyDeletedPurgeButton(accountId)` | `recently-deleted-purge-btn-${accountId}` | `AccountsListSection.tsx:1153` | ✓ |
| `permanentDeleteModal` | `account-permanent-delete-modal` | `AccountPermanentDeleteModal.tsx:68` | ✓ |
| `permanentDeleteConfirmButton` | `account-permanent-delete-confirm-btn` | `AccountPermanentDeleteModal.tsx:115` | ✓ |

**SettingsActions** (7 new methods):

| Method | Locator | Source testid | Match |
|---|---|---|---|
| `clickAccountDeleteButton` | `account-delete-btn-${accountId}` | `AccountsListSection.tsx:630` | ✓ |
| `confirmSoftDelete` | `account-soft-delete-confirm-btn` | `AccountSoftDeleteModal.tsx:119` | ✓ |
| `cancelSoftDelete` | `account-soft-delete-cancel-btn` | `AccountSoftDeleteModal.tsx:110` | ✓ |
| `clickRecentlyDeletedRestore` | `recently-deleted-restore-btn-${accountId}` | `AccountsListSection.tsx:1143` | ✓ |
| `clickRecentlyDeletedPurge` | `recently-deleted-purge-btn-${accountId}` | `AccountsListSection.tsx:1153` | ✓ |
| `fillPermanentDeleteConfirmation` | `account-permanent-delete-input` | `AccountPermanentDeleteModal.tsx:91` | ✓ |
| `confirmPermanentDelete` | `account-permanent-delete-confirm-btn` | `AccountPermanentDeleteModal.tsx:115` | ✓ |

**35 new page-object methods verified. Zero testid drift found.** ✓

---

## Stale-Artifact Compliance

All greps during this review scoped to `apps/`, `libs/`, `db/migrations/`. No `.next/`, `dist/`, or other build-output directories consulted. ✓

---

## Finding Count by Severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |
| Informational | 0 |

---

## Conclusion

All 9 Phase 4 delta items are CLEAN. The defensive `fee_profiles` fix (iter-1 informational note → genuine correctness fix) is confirmed correctly implemented in both `loadStore` JOIN and `saveStore` DELETE. The page-object additions are drift-free against source testids. Wave 1 implementation remains in full compliance following Phase 4 changes.
