# Transition Note: KZO-179 — Multi-account creation UX

**Type:** Frozen snapshot  
**Date:** 2026-04-28T00:12Z  
**Ticket:** KZO-179  
**Branch merged from:** `worktree-kzo-179`  
**Parent ticket:** KZO-167 (account `default_currency` + `account_type` enum + cash entry currency guard)

---

## TL;DR

KZO-179 ships the user-facing account creation surface that KZO-167 explicitly deferred. Three things landed together: a `POST /accounts` Fastify route with Zod validation and per-user name uniqueness, an "Accounts" tab in the existing settings drawer (6 tabs total), and migration 041 which adds a `created_at` forensic column and the `ux_accounts_user_id_name` unique index. The existing per-account list section (`AccountFallbackSection`) was renamed to `AccountsListSection` and relocated from the Fees tab into the new Accounts tab. Deferred to downstream tickets: the FX Transfer callout link (KZO-168), user-level reporting currency (KZO-180), and `account_type` behavioral semantics for bank/wallet (KZO-170/171).

---

## Behavioral Changes

### 1. New `POST /accounts` route

**Location:** `apps/api/src/routes/registerRoutes.ts`

**Request body** (Zod-validated, 400 on parse failure):

```ts
{
  name: string,         // trim().min(1).max(80) — whitespace stripped before persistence
  defaultCurrency: "TWD" | "USD" | "AUD",
  accountType: "broker" | "bank" | "wallet",
  feeProfileId?: string  // optional; resolved per cascade below
}
```

**Fee-profile resolution cascade (D5):**

1. `feeProfileId` provided in body → validated via `requireProfile(store, id)` (404 `fee_profile_not_found` if not found)
2. `feeProfileId` omitted + `defaultFeeProfileIdFor(userId)` exists in store → use default
3. `feeProfileId` omitted + default deleted → use `store.feeProfiles[0].id` (always non-empty per `must_keep_one_profile` invariant)

**Response:** 200 `AccountDto` (bare shape — `id`, `userId`, `name`, `feeProfileId`, `defaultCurrency`, `accountType`). `createdAt` is NOT on the DTO (D2/D7).

**Error codes:**

| Status | `body.error` code | Condition |
|---|---|---|
| 400 | Zod validation message | Body fails schema validation |
| 404 | `fee_profile_not_found` | Explicit `feeProfileId` not in store |
| 409 | `account_name_in_use` | Pre-check or `isUniqueViolation` TOCTOU catch |
| 500 | `no_fee_profile_available` | Store has zero fee profiles (should never occur in practice) |

**Uniqueness enforcement (D3):** Route does an explicit pre-check (`store.accounts.some(a => a.name === body.name)`) for clean UX, then wraps `saveStore` in a `try/catch(isUniqueViolation)` as the TOCTOU safety net. The DB index is the authoritative constraint; the pre-check is an optimization. Case-sensitive: `"Main"` and `"main"` are different names.

**Route-key registration (D10):** `"POST /accounts"` is appended to both `WRITER_ROLE_ROUTE_KEYS` (line 342) and `WRITE_CONTEXT_GUARD_ROUTE_KEYS` (line 380). Demo users may create accounts; shared-context viewers 403.

**Helper extracted:** `defaultFeeProfileIdFor(userId): string` added to `apps/api/src/services/store.ts`. Replaces the duplicated magic string `${userId}-fp-default` previously only in `postgres.ts`. `isUniqueViolation` was a private function in `postgres.ts` — promoted to `export` so the route can use it.

---

### 2. New "Accounts" tab in `<SettingsDrawer>`

The settings drawer now has **6 tabs** (previously 5):

```
Profile | General | Fees | Accounts | Tickers | Display
```

The **Accounts tab** renders (in order, top to bottom):

1. `<AccountCreateForm>` — new component (see §3 below)
2. `<AccountsListSection>` — relocated section (see §4 below)

**Tab strip:** The tab-strip container was updated with `flex-wrap` so all 6 tabs wrap to a second row at narrow viewports (390px iPhone 14 Pro). Without the wrap, "Tickers" and "Display" clipped off-screen.

**Structural pattern — Pattern A (D1 + H1 Fix B):** The Accounts tab content renders as a sibling `div` block, **outside** the outer `<form onSubmit={handleSubmit}>` that wraps the General and Fees tabs. This is the same pattern used by Profile, Tickers, and Display. Rationale: `AccountCreateForm` has its own independent POST action; nesting it inside the outer settings-save form caused Enter-key presses in the name input to trigger `form.handleSubmit()` (settings save) instead of account creation. See §"Cross-cutting carve-outs" for the UnsavedChangesFooter side-effect.

---

### 3. New `<AccountCreateForm>` component

**Location:** `apps/web/features/settings/components/AccountCreateForm.tsx`

**Props:**

```ts
interface AccountCreateFormProps {
  feeProfiles: FeeProfileDto[];
  onCreate: (input: CreateAccountInput) => Promise<AccountDto>;
  onAccountsRefresh: () => void;
  dict: AppDictionary;
}
```

**Fields:**

- **Name input** (`account-create-name-input`): text, trimmed before submit.
- **Type pills** (`account-create-type-{broker|bank|wallet}`): `Building2` / `Landmark` / `Wallet` icons from `lucide-react`. All typed `type="button"` — do not trigger form submit.
- **Currency cards** (`account-create-currency-{TWD|USD|AUD}`): button-style with `ring-2 ring-indigo-300` on the selected state. All typed `type="button"`.
- **Fee-profile picker** (`account-create-fee-profile-select`): conditional — rendered only when `feeProfiles.length > 1` (D5). Hidden when user has exactly one profile.
- **Currency-lock callout** (`account-create-currency-lock`): `bg-blue-50 text-blue-700` info box. Body text: *"Each account holds one currency. To move money between currencies later, you'll use the FX Transfer flow."* Plain text — no link to FX Transfer (KZO-168 will wire the link when FX Transfer ships).
- **Live-preview chip** (`account-create-preview-chip`): uses `formatAccountOption` imported from `apps/web/features/cash-ledger/utils/accountOptions.ts` (extracted in KZO-167 — NOT duplicated per `nextjs-i18n-serialization.md`). Shows placeholder when name is empty.
- **Submit button** (`account-create-submit`, `type="submit"`): disabled when `name.trim() === ""`.

**Submit flow (D12):** `await onCreate(input); onAccountsRefresh(); resetForm();`. Errors: 409 → `accountCreateNameInUseError` inline message; all other failures → `accountCreateGenericError`.

**Accessibility:** The `<section>` is labelled via `aria-labelledby` pointing to the inner `<h3>` title element.

**`onAccountsRefresh` wiring in AppShell:** Wired to `dashboard.refresh` (`useDashboardData.refresh`) — the same `useCallback` that already refreshes the full dashboard snapshot (including `accounts` + `feeProfiles`). No new dashboard hook method was added. Mirrors `onProfileUpdate={profileData.refresh}` (AppShell.tsx line 861).

---

### 4. `AccountFallbackSection` removed from Fees tab; renamed to `AccountsListSection`

**File rename:** `apps/web/features/settings/components/AccountFallbackSection.tsx` → `AccountsListSection.tsx`. Component export renamed correspondingly.

**Relocation:** Removed from the Fees tab render block (~line 235 in the pre-KZO-179 drawer). Now lives below `AccountCreateForm` in the new Accounts tab.

**i18n key renames:**

| Old key | New key | EN value change |
|---|---|---|
| `accountFallbackSectionTitle` | `accountsListSectionTitle` | `"Account Fallback Profile"` → `"Your accounts"` |
| `accountFallbackSectionDescription` | `accountsListSectionDescription` | Fees-scoped framing → `"Rename an account or pick the fee profile that applies when no ticker override exists."` |

zh-TW updated to match new framing: `"你的帳戶"` / `"重新命名帳戶，或選擇代號未覆寫時要套用的預設費率。"` Naïve `grep -i fallback` would have missed the zh-TW drift (it contained no "Fallback" string) — caught by Code Reviewer M2 on iter 1.

**Callsite audit:** The rename grep returned only (a) the source file itself, (b) the `SettingsDrawer.tsx` import + JSX site, and (c) the i18n dict + type shape files. Zero other callers. Notably: no E2E specs, no tests, no storybook.

---

### 5. New `createAccount` web service export in `cashLedgerService.ts`

`apps/web/features/cash-ledger/services/cashLedgerService.ts` gained a new export:

```ts
export async function createAccount(input: CreateAccountInput): Promise<AccountDto> {
  return postJson<AccountDto>("/accounts", input);
}
```

Co-located with the existing `fetchAccounts` export — the module is the canonical "accounts service" surface in the web app.

**`vi.mock` factory audit (mandatory per `implementer-qa-test-ownership.md`):** `grep -rn "vi\.mock.*cashLedgerService" apps/web/test apps/web/tests` found exactly one factory: `apps/web/test/features/cash-ledger/CashLedgerClient.test.tsx:11`. That factory was updated to include `createAccount: vi.fn().mockResolvedValue([])` in the same diff. Without the update, Vitest throws `[vitest] No "createAccount" export is defined on the mock` on every test that imports from the mocked module.

---

### 6. New AppShell prop: `onAccountsRefresh`

`apps/web/components/layout/AppShell.tsx` (line 866) gained the `onAccountsRefresh={dashboard.refresh}` prop threaded through to `<SettingsDrawer>`. Wired to `useDashboardData.refresh` — the same `useCallback` that already re-fetches the full dashboard snapshot (accounts + feeProfiles + bindings). No new hook method was added. Mirrors `onProfileUpdate={profileData.refresh}` (line 861).

---

### 8. `data-testid="cash-ledger-account-select"` added to `CashLedgerClient.tsx`

`CashLedgerClient.tsx` line 270: the account filter `<select>` in the filter toolbar received `data-testid="cash-ledger-account-select"`. Previously had no testid. Added to support the E2E golden-path spec's filter-toolbar assertion. The parent container already has `data-testid="cash-ledger-filter-toolbar"` (line 242) — the new testid enables direct lookup.

---

## Migration 041

**File:** `db/migrations/041_kzo179_account_created_at_and_name_uniqueness.sql`

**DDL (both steps are idempotent):**

```sql
-- Step 1: forensic floor for account creation time
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 2: per-user name uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_id_name
  ON accounts(user_id, name);
```

**Key details:**

- `created_at` uses `DEFAULT NOW()` — existing rows backfill to **migration-run time** (not original creation time). This is the accepted forensic floor; it means "account existed no later than this timestamp." No historical creation timestamps are available for rows seeded before KZO-179 deployed.
- `ux_accounts_user_id_name` is **case-sensitive** (default Postgres collation; no `LOWER()` expression). `"Main"` and `"main"` coexist as distinct account names. The column order is `(user_id, name)` — `user_id`-leading for compatibility with per-user range scans.
- **No `DO $$` blocks needed.** KZO-167's migration 040 used `DO $$` for `ADD CONSTRAINT IF NOT EXISTS` (Postgres doesn't support native idempotency there). KZO-179's migration uses `ADD COLUMN IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS`, which are natively idempotent.
- `created_at` is NOT in the `DO UPDATE SET` clause of saveStore's `INSERT ... ON CONFLICT (id) DO UPDATE` — it is preserved on upsert, not overwritten.
- `createdAt` is **not exposed on `AccountDto`** after this migration. The column exists in the DB but is not surfaced in the API response shape.

**Rollback:** `DROP INDEX IF EXISTS ux_accounts_user_id_name; ALTER TABLE accounts DROP COLUMN IF EXISTS created_at;` (safe since no production code reads `created_at` yet).

---

## Explicit No-ops

These items were explicitly considered and rejected or deferred in KZO-179.

### No `account_created` audit-log entry (D2)

Every existing `appendAuditLogTx` call writes admin/security/identity events (`share_granted`, `admin_role_change`, `app_config_updated`, `user_login`, etc.). No personal-portfolio CRUD route — `POST /fee-profiles`, `PATCH /accounts/:id`, `POST /portfolio/transactions` — writes audit entries. Adding `account_created` would set a one-way precedent and dilute admin-incident signal in `/admin/audit-log`. The `created_at` column is the forensic replacement.

### `createdAt` not on `AccountDto` (D2/D7)

The column exists in the DB after migration 041. It is not exposed in the API response. Future tickets may promote it if a UI needs sort-by-creation or audit display. Existing `AccountDto` shape (id, userId, name, feeProfileId, defaultCurrency, accountType) is unchanged.

### No `updatedAt` on `AccountDto`

Same reasoning. Not added.

### No account-count cap, no rate limit (D4)

`POST /accounts` is auth-gated and write-context-guarded. Per-user storage cost is bounded by the user themselves. If abuse appears, the `fastify-eviction-lifecycle-pattern.md` sliding-window rate-limiter is the right tool — better than a hard cap for legitimate power users. Deferred until a concrete abuse signal.

### No `DELETE /accounts` route, no archive UI

Deferred until a product need arises.

### `account_type` still metadata-only (D4 from KZO-167)

Bank and wallet accounts continue to accept the same entry types and trade events as broker accounts. Behavioral semantics based on `account_type` are explicitly deferred to KZO-170 (US broker) and KZO-171 (AU broker) which have concrete product reasons.

### No FX Transfer link in callout (D6)

The currency-lock callout is intentional plain text. KZO-168 (FX Transfer producer side) will wire the link when that flow ships. A link to a non-existent flow would be confusing UX.

---

## Cross-cutting Carve-outs to Be Aware of Post-merge

### Suite 7 `[timeframe-Q]` failure — NOT a KZO-179 regression

`dashboard-timeframe-aaa.spec.ts:490` (`[timeframe-Q]: mobile path — Display tab → Timeframes section → toggle + Save works without gear`) failed 2/2 runs in the KZO-179 8-suite gate with:

```
Test timeout of 60000ms exceeded.
Error: page.setViewportSize: Target page, context or browser has been closed
  at dashboard-timeframe-aaa.spec.ts:550:30
```

The spec file has not been touched by KZO-179 (`git log` confirms sole author is KZO-161). The failure is a structural `afterEach` flaw — viewport restoration attempts to run after the browser context has already been closed by the timeout. **This is a pre-existing deterministic failure in the KZO-161 spec.** All other 82 OAuth E2E tests pass. Validator ran twice and confirmed the same failure both times.

**Recommended action:** Open a follow-up ticket in KZO-161 territory to fix the `afterEach` viewport-restore guard.

---

### Unsaved-state discoverability degradation — Accounts tab binding writes (H1 Fix B side-effect)

**What changed:** H1 Fix B (iter 1) moved the Accounts tab content from inside the outer settings-save `<form>` to a sibling render block (Pattern A). This fixed the Enter-key collision (Enter in the name input was triggering `form.handleSubmit()` — the settings save — instead of account creation).

**Side effect:** `AccountsListSection`'s fee-profile binding dropdown and rename flow mutate `form.draft.accounts`. Those mutations set `useSettingsForm.isDirty = true`, but `UnsavedChangesFooter` (which renders the Save / Discard bar) is now scoped to the outer form — which only renders for `general`/`fees` tabs. Result: a user who changes a fee-profile binding or renames an account from the Accounts tab doesn't see the Save bar while on the Accounts tab. They must navigate to General or Fees to discover and commit the unsaved changes.

**Accepted for KZO-179:** The pattern is functional (changes are not lost — `form.draft` retains them until the user navigates to a tab with the Save bar) and the H1 risk (form-submit collision) outweighs this usability friction.

**Recommended follow-up:** Convert fee-profile binding writes and renames (in `AccountsListSection`) to direct `PATCH /accounts/:id` calls (mirroring the existing rename pattern) rather than routing through `form.draft`. This would fully eliminate the discoverability issue. No blocked tickets in the current roadmap; suggest scoping as a follow-up to KZO-181 (FeeProfile binding cleanup investigation).

---

### Cash-ledger filter dropdown — new accounts with no entries don't appear

The filter dropdown in `CashLedgerClient.tsx` derives its options from `summary.map(...)` (line 197), where `summary` is the list of accounts that have at least one cash-ledger entry. A freshly-created account with zero cash entries does not appear in the filter until first activity.

The E2E golden-path spec (suite 6) handles this as Option B: assert the filter toolbar is visible and the select element is present, but do not assert that the new account appears as an option (correct — it has no entries yet, so it would not appear).

**Recommended follow-up:** Source the dropdown from `accountMeta` (the richer account shape that includes all accounts regardless of activity) instead of `summary`. This would make all accounts visible in the filter from the moment of creation. Scope as a UI refinement ticket.

---

## Forward Links

| Ticket | What it closes |
|---|---|
| KZO-168 | FX Transfer producer side — cash-entry type, route, UI. Will also wire the callout link (D6) in `AccountCreateForm`. |
| KZO-180 | User-level reporting currency: `user_preferences.reportingCurrency` JSONB key + dashboard / portfolio-summary FX-aware consumers + settings UI. |
| KZO-181 | FeeProfile / FeeProfileBinding mirror cleanup investigation. Natural home for the follow-up that converts `AccountsListSection` binding writes to direct PATCH. |
| KZO-170 | US broker behavioral semantics on `account_type`. |
| KZO-171 | AU broker behavioral semantics on `account_type`. |

---

## References

- **Scope-todo (locked decisions D1–D13, phases 1–9):** `docs/004-notes/kzo-179/scope-todo-202604272000-multi-account-creation.md`
- **Mockup (HTML + PNG):** `docs/004-notes/kzo-179/mockup-202604272000-account-creation.html` / `.png`
- **Parent ticket transition note:** `docs/004-notes/kzo-167/transition-202604271800-account-currency-and-type.md`
- **Parent ticket chip mockup:** `docs/004-notes/kzo-167/mockup-cash-ledger-chip.html`
- **Code review iter 1:** `docs/004-notes/kzo-179/review-202604280038-iter1.md`
- **Code review iter 2 (PASS):** `docs/004-notes/kzo-179/review-202604280732-iter2.md`
- **Validator iter-1 report (includes iter-2 visual re-verification):** `.worklog/team/validator/iter1-report.md`
