---
slug: kzo-183
type: code-review
created: 2026-04-28
reviewer: main session (Claude Opus 4.7, 1M)
scope: Resume-session fixes + KZO-183 implementation surfaces touched after Phase 1 close
status: complete
---

# KZO-183 — pre-PR code review (resume session)

**Coverage:** the Phase-1 implementation (committed/staged before resume) plus the resume-session fixes that brought all 8 test gates green.

**Result:** **APPROVE WITH MINOR CLEANUPS.** No P0/P1 blockers. Two P2 hygiene items and three P3 hygiene items called out below.

> **Post-fix update (2026-04-28T23:10Z):** all P2 + P3 items below have been addressed. Re-ran full 8-suite gate after the fixes — lint clean, typecheck clean, suite 3 (307), suite 4 (833 / 279 skipped), suite 5 (566 / 1 skipped, 50 files), suite 6 (186), suite 7 (83), suite 8 (169). Resolution notes inline below.

---

## Summary

| Severity | Count | Pre-merge action |
|---|---|---|
| **P0** Blocker | 0 | — |
| **P1** Critical | 0 | — |
| **P2** High (recommend before merge) | 2 | optional cleanup |
| **P3** Medium (post-merge OK) | 3 | trackable |
| **P4** Informational | 4 | for awareness |

---

## P2 — High (recommend before merge, but not blockers)

### P2-1. `marketCodeFor` throws a generic `Error` instead of a `routeError` ✅ RESOLVED

`assertTradeMarketMatchesAccount` now wraps the `marketCodeFor` call in a try/catch and re-throws as `routeError(400, "trade_market_mismatch", ...)`. The pre-existing `assertDividendMarketMatchesAccount` does not call `marketCodeFor` (currency comparison is direct), so no symmetric fix needed there. `currencyFor` is exported but currently has no callers.

**Where:** `libs/shared-types/src/index.ts:~155`
```ts
export function marketCodeFor(currency: string): MarketCode {
  if (currency in MARKET_CURRENCY_PAIRS) { return MARKET_CURRENCY_PAIRS[currency as AccountDefaultCurrency]; }
  throw new Error(`unsupported_currency_for_market: ${currency}`);
}
```

**Risk:** if an `account.defaultCurrency` somehow leaks past the CHECK constraint (TWD/USD/AUD), the generic `Error` becomes a 500 response in `assertTradeMarketMatchesAccount` / `assertDividendMarketMatchesAccount` instead of a 4xx with code. Per `service-error-pattern.md`, services must use `routeError`.

**Mitigations already in place:**
- `accounts.default_currency` has a CHECK constraint enumerating TWD/USD/AUD (migration 040).
- The DB-level `currency_to_market` SQL function is also strict.

So in practice this can only fire if a row was directly INSERTed bypassing the CHECK — extremely unlikely.

**Fix (optional, ~5 lines):** the helper lives in `libs/shared-types` which has no `routeError` dependency. Either:
- catch the `Error` at every call site and re-throw `routeError(500, "unsupported_currency_for_market", ...)`, **OR**
- duplicate the input validation at the service boundary so `marketCodeFor` is only called with a vetted union.

The status quo is acceptable for now; flag for follow-up if 500-class telemetry surfaces this code path.

### P2-2. The validation step at `registerRoutes.ts:2473-2492` overlaps with `ensureBindingsAreValid` ✅ RESOLVED

Dropped the redundant `ensureBindingsAreValid(draftStore, nextBindings)` call at line 2499 in the bulk-save flow. The other two callers (`PUT /settings/fee-config`, `PUT /fee-profile-bindings`) keep `ensureBindingsAreValid` because they don't run the bulk-save step 3 — added an inline comment so future readers understand why the bulk-save path skips it.

**Where:** `apps/api/src/routes/registerRoutes.ts`
- New step 3 loop (lines 2473-2492) — validates `binding.accountId` against `knownAccountIds`, then ownership against the in-memory profile map.
- `ensureBindingsAreValid(draftStore, nextBindings)` at line 2499 — runs the *same* checks against the just-built draftStore.

**Risk:** the redundancy is harmless today but invites drift. A future change that adjusts the validation rules in only one of the two checks would create inconsistent error envelopes (different `body.error` codes for the same input shape across paths).

**Fix (optional, ~8 lines):** drop `ensureBindingsAreValid(draftStore, nextBindings)` at line 2499 (the new step 3 already covers it) OR drop the explicit step 3 and let `ensureBindingsAreValid` carry the contract. If keeping `ensureBindingsAreValid`, add a `// the new step 3 above is the user-facing surface; this is defense-in-depth` comment so future readers know.

---

## P3 — Medium (post-merge OK)

### P3-1. `visibleAccounts` `useMemo` is now a no-op ✅ RESOLVED

Deleted the no-op `useMemo` and inlined `accounts.map(...)` at the rendering site. The leading explanatory comment about scope decision 27 stayed in place.

**Where:** `apps/web/features/settings/components/AccountsListSection.tsx:194`
```ts
const visibleAccounts = useMemo(() => accounts, [accounts]);
```

After the fix that removed search-driven filtering, this returns `accounts` unchanged. The `useMemo` cost is negligible but the indirection adds noise.

**Fix (1 line):** replace `visibleAccounts.map(...)` with `accounts.map(...)` and delete the `useMemo`.

### P3-2. `AccountsListSection` still imports `Search` icon but doesn't use other search-only state

The search-input branch is fine. Just noting that `matchedAccountIds` is still computed when `search.length === 0` (returns empty Set early). That's already optimized — no change.

### P3-3. `bindings` prop name in `AccountsListSection` ✅ RESOLVED

Renamed `bindings` → `accountDrafts` on the `AccountsListSection` props interface, the destructured caller, the internal `find()` reference, the `SettingsDrawer.tsx` JSX call site, and the unit test (`RenderOptions` interface + the four call sites that used the keyword shorthand). Added a doc-comment in the interface explaining why the rename happened.

**Where:** `apps/web/features/settings/components/AccountsListSection.tsx`
```ts
interface AccountsListSectionProps {
  accounts: AccountDto[];
  bindings: SettingsAccountBindingModel[];   // ← naming is misleading
  ...
}
```

`bindings` is the form's draft `accounts` array (one entry per account, carrying the editable feeProfileId). Calling it `bindings` is confusing — `accountDrafts` or `accountBindings` would read better. Pre-existing — not introduced by KZO-183 — but worth a follow-up rename if the file is reopened.

---

## P4 — Informational

### P4-1. Migration 042 fan-out id format

`new_profile_id = old_profile_id || ':acc:' || account_id` when `is_primary = FALSE`. Both `fee_profiles.id` and `fee_profile_tax_rules.id` are TEXT with no length cap. The colon is not in the legacy id format, so no collision with org-typed UUIDs. Good.

### P4-2. Trigger `currency_to_market(NULL)` propagation

`SELECT currency_to_market(default_currency) INTO expected_market FROM accounts WHERE id = NEW.account_id;` — if no row matches, `expected_market` stays NULL and the explicit `IF expected_market IS NULL THEN RAISE EXCEPTION 'unknown account'` handles it. Good.

If a row exists but `default_currency` is something `currency_to_market` rejects (defensive — should be impossible per CHECK), the function raises before INTO assigns, propagating the exception correctly.

### P4-3. The 30 s timeout on the migration-walk test

`postgres-migrations.integration.test.ts > "applies accounting schema objects including dividend alignment"` was bumped from default 5 s to 30 s because migration 042 adds 200+ lines (pre-flight + backfill + functions + triggers) and a cold `init()` on a slow host can exceed 5 s. Successive runs land at ~3.7 s, so the 30 s cap is plenty of headroom.

### P4-4. Resume-session route fix at `registerRoutes.ts:2887-2899` runs an extra `getInstrument` query for the Postgres path

For Postgres, `loadStore()` already loads all instruments into `store.instruments`, so the extra `getInstrument(body.ticker)` call is redundant (still correct — `upsertInstrumentDefinitions` is idempotent). For Memory, it's load-bearing because the seeded catalog lives in `instrumentsByUser` while the cached store has only the default instruments. Acceptable cost for a uniform path. Could be guarded by a `store.instruments.find(...)` pre-check if profiling later shows it on the hot path.

---

## What I checked (and found clean)

- **Migration 042 backfill correctness** — pre-flight CHECKs gate the migration; primary-tie-break by `(is_default DESC, account_id ASC)` deterministic; tax-rule cascade preserves rule ids via `:acc:` suffix; orphan profile rows deleted (Backfill 6).
- **Composite-FK ownership invariant** — UNIQUE (id, account_id), DEFERRABLE INITIALLY DEFERRED on accounts.fee_profile_id, regular FK on overrides. Test coverage exhaustive (FPS-1..7).
- **Memory ownership mirror** — `validateMemoryStoreOwnership` enforces both account.feeProfileId and feeProfileBindings.feeProfileId. Same error class as Postgres.
- **Trade + dividend market guards** — service-layer assertions throw `routeError(400, ...)` with stable codes (`trade_market_mismatch`, `dividend_market_mismatch`). DB triggers are defense-in-depth (SQLSTATE 23514).
- **Settings bulk-save validation** — three-step order matches scope-todo D7. New step 3 fires `invalid_account` before `invalid_fee_profile` when binding references unknown account.
- **Frontend rescope** — Fees tab + FeeProfilesSection + SecurityBindingsSection deleted; per-account expandable cards + duplicate flow + search filter live in `AccountsListSection`. `noValidate` on the General-tab form lets the JS validator surface localized validation errors. UnsavedChangesFooter on the Accounts tab uses `onSaveClick` (no nested form; AccountCreateForm has its own `<form>`).
- **Test coverage** — Suite 3 (307), Suite 4 (545+102+109), Suite 5 (566 + 1 skip), Suite 6 (186), Suite 7 (83), Suite 8 (169). Lint + typecheck clean across 6 tsconfigs.
- **Documentation (Phase G)** — `docs/001-architecture/backend-db-api.md` calls out the KZO-183 ownership model + 1:1 currency↔market; `docs/001-architecture/canonical-accounting-model.md` notes `fee_profiles.account_id` as the ownership root; `docs/002-operations/runbook.md` §9.5 documents the migration-042 dry-run gate; transition note + mockup HTML/PNG present.
- **PR description draft** — has Problem / Solution / Testing (Evidence with concrete suite counts) / Risk-Rollback per `pr-bound-docs-review-compliance.md`.

---

## Suggested ordering for fix list

1. **Optional — P2-1**: harden `marketCodeFor` (only if you want zero 500-class risk).
2. **Optional — P2-2**: consolidate the bindings validation (drop one of the two checks).
3. **Optional — P3-1**: drop the no-op `useMemo` for `visibleAccounts`.
4. **Defer — P3-2 / P3-3 / P4-***: post-merge follow-ups; do not block this PR.

## Manual action remaining (Phase H)

H1 — close KZO-181 in Linear with the supersession comment per scope-todo decision item 43. Linear API action; no code change.
