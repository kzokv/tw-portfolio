---
slug: kzo-183
source: scope-grill
created: 2026-04-28
tickets: [KZO-183]
required_reading: []
superseded_by: null
---

# Todo: KZO-183 — Account-scoped fee profiles + account-market binding

> **For agents starting a fresh session:** This scope-todo is the sole handoff artifact from the 2026-04-28 grill session. Read the locked decisions in full before opening any source file. KZO-182 (settings drawer refresh bug fix) MUST ship before this ticket per Q7 Sub-2; KZO-181 is closed as "superseded by KZO-183."

## Origin

User flagged after KZO-179 merge (PR #148, 2026-04-28) that they want each account tied to a country market (TW / US / AU) and each account's fee profiles to be isolated from other accounts. Today's user-scoped fee profiles + ungated trade routing are too loose for that mental model. Scope-grill ran 2026-04-28; debate was not triggered (resolved entirely in Phase 1 + Phase 1.5).

## Locked decisions

### Architecture

1. **Hard rescoping:** `fee_profiles` becomes account-scoped (one-to-many via `fee_profiles.account_id`). User-scoped sharing is removed entirely. Profiles cannot be shared across accounts.
2. **Account-market binding:** every account is tied to exactly one market. Market is **derived** from `accounts.default_currency` via `marketCodeFor()` helper in `libs/shared-types`. 1:1 mapping locked: TWD↔TW, USD↔US, AUD↔AU. **No new column** on `accounts`.
3. **Validation surface:** trades and dividends MUST match the account's derived market. Service-layer guard (mirroring KZO-167's `cashLedger.ts` pattern) AND DB-level `CHECK` on `trade_events` + `dividend_ledger_entries`. Strict rollout — migration aborts if existing data violates.
4. **`account_fee_profile_overrides`** survives for per-symbol routing within an account. Loses `market_code` column. PK becomes `(account_id, ticker)`.
5. **Ownership invariant** enforced via composite-FK pattern (mirrors `accounts(id, user_id)` precedent — see Critical Gap 1 in the grill). Both `accounts.fee_profile_id` and `account_fee_profile_overrides.fee_profile_id` must reference profiles owned by the same account.
6. **`accounts.fee_profile_id`** survives semantically as "the default profile within this account's list."

### Schema (migration `042_kzo183_account_scoped_fee_profiles.sql`)

7. Add `fee_profiles.account_id NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`.
8. Drop `fee_profiles.user_id`, `fee_profile_tax_rules.user_id`, `account_fee_profile_overrides.market_code`.
9. Add `CHECK` on `trade_events` and `dividend_ledger_entries` enforcing `market_code` matches the account's derived market.
10. Add unique constraint `UNIQUE (id, account_id)` on `fee_profiles`. Add composite FK from `accounts(fee_profile_id, id) → fee_profiles(id, account_id)` and from `account_fee_profile_overrides(fee_profile_id, account_id) → fee_profiles(id, account_id)`.
11. Backfill: per-(account, fee_profile) pair → new owned `fee_profiles` row; **suffix duplicated profile names** as `"<original> (Account <name>)"`. Cascade-duplicate `fee_profile_tax_rules` along the same (old → new) id map.
12. Pre-flight CHECKs abort migration on any existing market-mismatch violation. **Operator dry-run gate is mandatory** — see step 14.
13. **No down migration.** Per `migration-strategy.md`, applied migrations are immutable.
14. **Operator dry-run script** at `scripts/migrate/042-dry-run.sh`: runs the fan-out query (count of `fee_profiles` referenced by N accounts), counts pre-flight violation rows for `trade_events` + `dividend_ledger_entries`, prints summary. Required reading before deploy.
15. **`trade_fee_policy_snapshots.profile_id_at_booking`** is left dangling (snapshot is denormalized — carries all rate fields verbatim, the id is decorative for audit display). Document this trade-off in the migration comment header.

### API

16. `POST /accounts` body becomes `{ name, defaultCurrency, accountType }` — drops `feeProfileId?`. Route auto-seeds a UUID-based default profile in same transaction; sets `account.fee_profile_id = new_profile.id`.
17. Settings save endpoint **keeps bulk-save pattern** (`registerRoutes.ts:2318` shape). Reshape body for account-scoped profiles. Validates ownership invariant at route layer before commit.
18. **`AccountDto` stays flat** (today's shape unchanged: `{ id, name, userId, feeProfileId, defaultCurrency, accountType }`).
19. **`FeeProfileDto`** gains `accountId`, drops `userId`. **`FeeProfileBindingDto`** drops `marketCode`.
20. `GET /fee-profiles` returns flat list with `accountId` discriminator (NOT nested into accounts). Settings drawer pivots to per-account view client-side.
21. New error code: `trade_market_mismatch` (status 400). Surfaced via `routeError(400, "trade_market_mismatch", ...)`. Inline error message gets surfaced in cash-ledger / transactions UI form like KZO-167.
22. Delete `defaultFeeProfileIdFor(userId)` helper from `apps/api/src/services/store.ts:41`. New accounts get UUID-based default profiles via creation-time INSERT.

### Frontend

23. **Remove Fees tab entirely** from `apps/web/components/settings/SettingsDrawer.tsx`. Tab strip drops to 5 (Profile / General / Accounts / Tickers / Display). Delete the `tabFeeProfiles` button and `form.tab === "fees"` branch.
24. Delete `apps/web/features/settings/components/FeeProfilesSection.tsx` and `apps/web/features/settings/components/SecurityBindingsSection.tsx`. Their UX merges into per-account expandable cards.
25. `AccountCreateForm.tsx`: re-label currency cards as **"Taiwan / United States / Australia"** (i18n keys e.g. `accountCreateMarketTaiwan/UnitedStates/Australia`). Field stays `defaultCurrency`; copy change only.
26. `AccountsListSection.tsx`: replace flat list with **per-account expandable cards**. Each card has:
    - Header: account name + market badge + rename + default fee-profile selector (options scoped to `account.profiles[]`)
    - Inline fee-profiles list with add / edit / delete
    - **"Duplicate from another account"** CTA — opens picker, deep-copies on confirm (Q4 Option B's UI helper)
    - Inline per-symbol overrides list (replaces `SecurityBindingsSection`'s content)
27. **Top-of-tab search input** filters card visibility by profile name match (client-side). Cards with hits stay expanded; misses collapse. Ship from day one (Q5 Sub-2).
28. `useSettingsForm.ts` reshape: `draft.feeProfiles[]` keeps flat with `accountId` discriminator (per Q7 Sub-3). Update merge-on-grow effect (introduced in KZO-182) to also init the auto-seeded default profile when a new account arrives.
29. Wire `POST /accounts` adaptation: the web service `createAccount(input)` no longer sends `feeProfileId`; default is auto-seeded server-side.
30. i18n cleanup: drop `tabFeeProfiles`. Refresh `accountsListSectionTitle/Description`. Add new keys: market labels, per-account fee-profiles list, search, "Duplicate from another account."

### Test coverage

31. **Web unit (suite 3):**
    - `AccountsListSection.test.tsx` — per-account expandable cards, default selector scoped to account, profile CRUD, "Duplicate from another account" deep-copy.
    - `AccountCreateForm.test.tsx` — re-labeled markets ("Taiwan/US/Australia"), submit flow.
    - Search bar — client-side filter highlights/expands cards on hit.
32. **Integration (suite 5 Postgres, `describePostgres` per `integration-test-persistence-direct.md`):**
    - Composite-FK ownership violation rejected (insert profile owned by acc-A then point acc-B at it → reject).
    - Migration backfill on multi-account multi-profile fixtures (verify suffixed names, fan-out, cascade).
    - Strict-rollout pre-flight CHECK rejection (insert violating `trade_events` row → migration aborts).
33. **HTTP (suite 8):**
    - New `POST /accounts` body shape (no `feeProfileId`); auto-seeded profile visible via `GET /fee-profiles?account_id=...`.
    - Per-account fee-profile bulk-save (happy path + validation rejection + ownership rejection).
    - `trade_market_mismatch` route error response (`body.error === "trade_market_mismatch"` per `service-error-pattern.md` envelope rule).
34. **E2E (suite 6 dev_bypass):**
    - Create-account with re-labeled "Taiwan/US/Australia" cards → market badge displayed.
    - Seed TW + US trades; US-ticker trade against TW account rejected at form-time with the new error code.
    - Per-account fee-profile add/edit/delete.
    - "Duplicate from another account" deep-copies (verify rates carried over but new id).
    - Search filter highlights matching cards.
35. Update KZO-179's `apps/web/tests/e2e/specs/account-creation-aaa.spec.ts` and `apps/api/test/http/specs/account-creation-aaa.http.spec.ts` for new `POST /accounts` body (drops `feeProfileId`).
36. Run `/aaa` to ensure new E2E specs follow AAA pattern.
37. Mirror ownership invariant in `MemoryPersistence.validateStore` (per `test-placement-persistence-backend.md`). MemoryPersistence won't enforce composite FK at the SQL level; the application-layer check fills the gap for unit tests.

### Documentation (Wave 2)

38. Update `docs/001-architecture/` data-model section for account-scoped fee profiles + market-binding derivation. Refresh fee-profile resolution flow diagrams.
39. Refresh `docs/002-operations/runbook.md` with the new dry-run gate procedure for migration 042.
40. Add transition guide `docs/004-notes/kzo-183/transition-{datetime}-account-scoped-fee-profiles.md`: covers schema rescope, behavioral changes, settings drawer UX shift, dangling `profile_id_at_booking` decision.
41. Generate fresh mockup of new Accounts tab layout (per Phase 3d of the grill — ships alongside this scope-todo).
42. Per `pr-bound-docs-review-compliance.md`, the PR description draft for KZO-183 must include `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback` sections — pre-bake into the Wave 2 brief.

### Sibling-ticket cleanup

43. Close KZO-181 in Linear: status "Cancelled" with comment "Superseded by KZO-183 — type-mirroring rewrite happens as part of fee-profile rescope. `taxRules?` consolidation question absorbed into KZO-183's locked scope (decision item 19 / 22)."

## Out of scope (explicit)

- Profile sharing across accounts (any join table or template-library mechanism).
- New `accounts.market_code` column (derived, not stored).
- Down migration / rollback path.
- Updating `profile_id_at_booking` during backfill (left dangling).
- Per-resource fee-profile CRUD endpoints (bulk-save kept).
- Power-user search beyond client-side name match (defer if usage signals demand it).
- Refresh of KZO-179's HTML/PNG mockup (`docs/004-notes/kzo-179/mockup-202604272000-account-creation.html`) — frozen artifact per `doc-management.md`.
- New 4th market support (HK / JP / SG). Out of scope until product signals demand.

## Open Items

*(none — no debate triggered, no items deferred from this grill)*

## Implementation Steps (ordered for `/team` consumption)

### Phase A — DB schema + migration

- [ ] A1. Author migration `db/migrations/042_kzo183_account_scoped_fee_profiles.sql` with all 9 sub-steps from decision item 12 (pre-flight CHECKs → snapshot fan-out → duplicate `fee_profiles` → cascade `fee_profile_tax_rules` → repoint `accounts.fee_profile_id` and `account_fee_profile_overrides.fee_profile_id` → drop `user_id` / `market_code` columns → add new FKs and CHECKs → composite-FK ownership constraint).
- [ ] A2. Author `scripts/migrate/042-dry-run.sh` — fan-out query + violation count + summary print. Mandatory before deploy per `migration-strategy.md`.
- [ ] A3. Document migration header comment: rationale, dangling `profile_id_at_booking`, irreversibility.

### Phase B — Domain types + helpers

- [ ] B1. Add `marketCodeFor(currency: AccountDefaultCurrency): MarketCode` + inverse `currencyFor(market: MarketCode): AccountDefaultCurrency` in `libs/shared-types/src/index.ts`.
- [ ] B2. Update `FeeProfileDto`: drop `userId`, add `accountId`. Confirm `taxRules?` placement (internal-only in `libs/domain` vs promoted to wire — per absorbed KZO-181 question).
- [ ] B3. Update `FeeProfileBindingDto`: drop `marketCode`.
- [ ] B4. Update `libs/domain/src/types.ts` `FeeProfile` interface alignment.
- [ ] B5. Per `shared-types-barrel-turbopack.md`: audit sibling `export *` for type-only downgrades if any new value export is added to `libs/shared-types/src/index.ts`.

### Phase C — Backend services + routes

- [ ] C1. `apps/api/src/services/trades.ts`: assert `tx.marketCode === marketCodeFor(account.defaultCurrency)`; throw `routeError(400, "trade_market_mismatch", ...)` on mismatch.
- [ ] C2. `apps/api/src/services/dividends.ts`: same guard for `dividend_ledger_entries`.
- [ ] C3. Rewrite `apps/api/src/services/recompute.ts:28-37` resolution cascade — drop the `marketCode` filter; search `account.profiles[]` (account-scoped) instead of `store.feeProfileBindings` (user-scoped).
- [ ] C4. Delete `defaultFeeProfileIdFor(userId)` from `apps/api/src/services/store.ts:41`. Update `createStore` (memory) and `ensureDefaultPortfolioData` (Postgres) to seed UUID-based per-account default profiles.
- [ ] C5. `POST /accounts` route (`registerRoutes.ts`): drop `feeProfileId?` from Zod body schema. Auto-seed default profile in same transaction; set `account.fee_profile_id = new_profile.id`.
- [ ] C6. `validateFeeProfilesExist` (`registerRoutes.ts:1010`): per-account scope check — every `account.fee_profile_id` references a profile owned by that same account.
- [ ] C7. Settings bulk-save endpoint (`registerRoutes.ts:2318`): reshape body to carry `accounts[]` + `feeProfiles[]` (each with `accountId`) + `feeProfileBindings[]`. Validate ownership invariant before commit.
- [ ] C8. Mirror ownership invariant in `MemoryPersistence.validateStore` (application-layer check fills SQL-level gap).

### Phase D — Test API extensions

- [ ] D1. Extend `AccountsEndpoint` (`libs/test-api/src/endpoints/`) with per-account fee-profile CRUD methods.
- [ ] D2. Reshape `FeeProfilesEndpoint` for new flat-with-`accountId` wire shape.
- [ ] D3. Verify `mapper.ts` registrations per `test-api-mapper-registration.md`.

### Phase E — Frontend reshape

- [ ] E1. Delete `tabFeeProfiles` button + `form.tab === "fees"` branch in `apps/web/components/settings/SettingsDrawer.tsx`. 5-tab strip.
- [ ] E2. Delete `apps/web/features/settings/components/FeeProfilesSection.tsx` and `SecurityBindingsSection.tsx`.
- [ ] E3. `AccountCreateForm.tsx`: re-label currency cards "Taiwan / United States / Australia" (copy + i18n keys only; field stays `defaultCurrency`).
- [ ] E4. `AccountsListSection.tsx`: per-account expandable cards (header + inline profiles list + "Duplicate from another account" CTA + inline overrides sub-list).
- [ ] E5. Top-of-tab search input — client-side filter / expand on hit.
- [ ] E6. `useSettingsForm.ts` reshape: `draft.feeProfiles[]` keeps flat with `accountId` discriminator. Update KZO-182's merge-on-grow effect to also init auto-seeded default profile.
- [ ] E7. Update web service `createAccount(input)` to drop `feeProfileId` from request body.
- [ ] E8. i18n cleanup (drop `tabFeeProfiles`, refresh `accountsListSectionTitle/Description`, add new keys per decision item 30).

### Phase F — Test coverage

- [ ] F1. Web unit (suite 3) per decision item 31.
- [ ] F2. Integration (suite 5 Postgres) per decision item 32.
- [ ] F3. HTTP (suite 8) per decision item 33.
- [ ] F4. E2E (suite 6 dev_bypass) per decision item 34.
- [ ] F5. Update KZO-179's existing test files for new `POST /accounts` body (decision item 35).
- [ ] F6. Run `/aaa` to add or update E2E tests covering the flows agreed in this scope session.

### Phase G — Documentation (Wave 2)

- [ ] G1. Update `docs/001-architecture/` data-model + flow diagrams.
- [ ] G2. Refresh `docs/002-operations/runbook.md` with dry-run gate procedure.
- [ ] G3. Add `docs/004-notes/kzo-183/transition-{datetime}-account-scoped-fee-profiles.md`.
- [ ] G4. Mockup HTML+PNG already produced alongside this scope-todo (Phase 3d) — committed in same PR as a frozen reference.
- [ ] G5. PR description draft compliance per `pr-bound-docs-review-compliance.md`: `## Problem`, `## Solution`, `## Testing` with `Evidence:` block, `## Risk/Rollback` sections.

### Phase H — Sibling-ticket cleanup

- [ ] H1. Close KZO-181 in Linear with the supersession comment (decision item 43).

## References

- **Linear:**
  - This ticket: KZO-183
  - Parent: KZO-179 (merged 2026-04-28)
  - Grandparent: KZO-167 (account default_currency + account_type, merged earlier)
  - Sibling bug fix (must ship first): KZO-182
  - Superseded by this ticket: KZO-181 (close in Phase H)
  - Parallel-shipping (no conflict): KZO-180, KZO-168, KZO-170, KZO-171

- **Codebase pivots (file:line):**
  - `db/migrations/baseline_current_schema.sql:46-125` — pre-rescope schema reference
  - `db/migrations/041_kzo179_account_created_at_and_name_uniqueness.sql` — most recent precedent migration
  - `apps/api/src/services/recompute.ts:28-37` — current resolution cascade to rewrite
  - `apps/api/src/services/store.ts:41` — `defaultFeeProfileIdFor` helper to delete
  - `apps/api/src/routes/registerRoutes.ts:1010,2318` — validateFeeProfilesExist + settings bulk-save endpoint
  - `apps/web/components/settings/SettingsDrawer.tsx:127-135,280-300` — Fees tab to remove
  - `apps/web/features/settings/components/AccountsListSection.tsx` — flat list to expand into per-account cards
  - `apps/web/features/settings/components/FeeProfilesSection.tsx` — to delete
  - `apps/web/features/settings/components/SecurityBindingsSection.tsx` — to delete
  - `apps/web/features/settings/hooks/useSettingsForm.ts:55-72` — closed→open seeding guard (KZO-182 will add merge-on-grow)
  - `libs/shared-types/src/index.ts:74-94` — DTO shapes to reshape
  - `libs/domain/src/types.ts:60-87` — internal `FeeProfile` shape to align
  - `libs/domain/src/fee.ts` — fee calculation engine (no behavioral changes; only consumes `FeeProfile`)

- **Conventions invoked (read each before touching the corresponding surface):**
  - `migration-strategy.md` — new migration file, no in-place edit, pre-deploy schema is immutable
  - `service-error-pattern.md` — `routeError()` for `trade_market_mismatch`; `body.error` is the code field
  - `playwright-web-bundle-rebuild.md` — rebuild standalone bundle before E2E iteration
  - `vitest-config-patterns.md` — auth-mode override + `Env.get*()` method mock for backend tests
  - `test-placement-persistence-backend.md` — ownership-invariant tests run against Postgres
  - `integration-test-persistence-direct.md` — use `PostgresPersistence` directly for integration tests
  - `nextjs-i18n-serialization.md` — i18n dictionary entries cannot be functions
  - `interface-caller-verification.md` — grep all callers when reshaping wire DTOs
  - `process-refactor-rename-verification.md` — grep cross-package callers when renaming exports
  - `shared-types-barrel-turbopack.md` — audit `export *` siblings when adding runtime value to a type-only barrel
  - `agent-team-workflow.md` — Tier 3 (Full Team) recommended given multi-week scope; Architect runs verification gates
  - `e2e-aaa-guardrails.md` + `e2e-shared-memory-bars-ticker-hygiene.md` — for new E2E specs
  - `pr-bound-docs-review-compliance.md` — Wave 2 PR description compliance
  - `commit-format.md` — `feat(api,db,web): KZO-183: ...`

- **Mockup:** `docs/004-notes/kzo-183/mockup-202604280300-accounts-tab.html` (HTML + PNG, generated by frontend-design skill alongside this scope-todo)
