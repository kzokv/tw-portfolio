---
slug: kzo-179
source: scope-grill
created: 2026-04-27
tickets: [KZO-179]
required_reading:
  - docs/004-notes/kzo-179/scope-todo-202604272000-multi-account-creation.md
  - docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md
  - docs/004-notes/kzo-167/transition-202604271800-account-currency-and-type.md
superseded_by: null
---

# Todo: KZO-179 — Multi-account creation UX: form + `POST /accounts`

> **For agents starting a fresh session:** read this file plus the Linear ticket KZO-179 description (the `## Locked Scope` section appended via this session) before starting implementation. Companion files for context: `db/migrations/040_kzo167_account_currency_and_type.sql` (precedent for the migration shape and `DO $$` constraint guards), `apps/api/src/routes/registerRoutes.ts:2479,2484,2552` (existing `GET /accounts`, `PATCH /accounts/:id`, and `POST /fee-profiles` precedent for the new route), `apps/api/src/persistence/postgres.ts:395,2233,4718` (default seed, saveStore upsert, `appendAuditLogTx`), `apps/web/components/settings/SettingsDrawer.tsx` (drawer shell — adding 6th tab), `apps/web/features/settings/components/AccountFallbackSection.tsx` (section to rename + relocate), `apps/web/features/cash-ledger/utils/accountOptions.ts` (live-preview chip helper to reuse), `libs/shared-types/src/index.ts:81` (`AccountDto`), `libs/test-api/src/endpoints/AccountsEndpoint.ts` (extend with `create`), `docs/004-notes/kzo-167/mockup-cash-ledger-chip.html` (visual contract reference for the chip styling). Rules: `migration-strategy.md`, `service-error-pattern.md`, `interface-caller-verification.md`, `test-placement-persistence-backend.md`, `integration-test-persistence-direct.md`, `nextjs-i18n-serialization.md`, `config-web-env-pattern.md`, `commit-format.md`, `code-review-before-pr.md`, `full-test-suite.md`, `test-api-mapper-registration.md` (no-op here — endpoint already registered), `playwright-web-bundle-rebuild.md`, `e2e-aaa-guardrails.md`, `pr-bound-docs-review-compliance.md`.

## Context (one-paragraph framing)

KZO-167 landed the schema, types, service guard, PATCH lockdown, and `/cash-ledger` chip display for per-account currency + type. That ticket explicitly deferred the user-facing creation surface to KZO-179 — without it, the new `default_currency` and `account_type` fields are mutable only via PATCH on the auto-seeded `Main` account, and the chip mockup's forward-looking `USD Brokerage` row is unreachable. KZO-179 closes that loop: a `POST /accounts` Fastify route with Zod validation + per-user name uniqueness + default fee-profile resolution, plus an "Accounts" tab in the existing settings drawer with a name input, type pills, currency cards, info callout, and live-preview chip. The form is not a new page — it lands inside the existing drawer, reusing established settings-tab infrastructure. The existing per-account list (rename + fee-profile selector) moves out of the Fees tab into the new Accounts tab so the surface is single-purpose. Audit-logging the create event was rejected (contradicts established convention — no other personal-portfolio CRUD route audit-logs); a `created_at` column on `accounts` provides the forensic floor instead.

## Decisions (locked via scope-grill 2026-04-27)

- **D1.** Page location is the existing settings drawer (`apps/web/components/settings/SettingsDrawer.tsx`). New "Accounts" tab added — drawer goes from 5 → 6 tabs (Profile / General / Fees / Tickers / Display / **Accounts**). The form lives at the top of the new tab; the existing per-account list (rename + fee-profile selector) moves down into the same tab. **No** new `/settings/accounts` page route, **no** modal on `/cash-ledger`. Fees tab keeps fee-profile CRUD only.
- **D2.** **No `account_created` audit-log entry.** Established convention: every existing `appendAuditLogTx` call writes admin/security/identity events (`share_granted`, `admin_role_change`, `app_config_updated`, `user_login`, etc.). No personal-portfolio CRUD route — `POST /fee-profiles`, `PATCH /accounts/:id`, `POST /portfolio/transactions` — writes audit entries. Adding `account_created` would set a one-way precedent and dilute admin-incident signal in `/admin/audit-log`. **Replacement:** new migration adds `accounts.created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` for forensic recoverability. `createdAt` stays a hidden DB column — **not** exposed on `AccountDto` in this ticket. Existing rows backfill to migration-run time (acceptable floor; documented in transition note).
- **D3.** **Account-name uniqueness — DB index + route pre-check.** Same migration adds `CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_id_name ON accounts(user_id, name)` (case-sensitive). Route handler does an explicit pre-check that throws `routeError(409, "account_name_in_use", "An account with that name already exists.")` for clean UX; saveStore call wrapped in `try { ... } catch (err) { if (isUniqueViolation(err)) throw routeError(409, "account_name_in_use", ...); throw err; }` as the TOCTOU safety net. Per `test-placement-persistence-backend.md`, the duplicate-name 409 test is routed to suite 5 (Postgres integration) or suite 8 (HTTP) only — `MemoryPersistence` divergence accepted (memory backend silently overwrites duplicates, same shape as the documented email-uniqueness gap).
- **D4.** **No account count cap in this ticket.** Defer until concrete abuse signal. POST /accounts is auth-gated and write-context-guarded; per-user storage cost is bounded by the user themselves. If abuse appears, the established `fastify-eviction-lifecycle-pattern.md` sliding-window rate-limiter is the right tool — better than a hard cap because it slows abuse without blocking legitimate growth.
- **D5.** **Fee-profile picker conditional.** Form renders the picker only when `feeProfiles.length > 1` (read from existing `SettingsDrawer` prop — no extra fetch). When `feeProfiles.length === 1`, picker hidden, default profile used silently. Route still accepts `feeProfileId?` as optional in body for API-flexibility paths. Resolution order in the route: (1) provided in body → validate via `requireProfile(store, id)`; (2) omitted + `defaultFeeProfileId(userId)` exists in store → use it; (3) omitted + default deleted → use `store.feeProfiles[0].id` (always non-empty per `must_keep_one_profile` invariant).
- **D6.** **Currency-lock info callout — plain text, no link.** Callout body (en): *"Each account holds one currency. To move money between currencies later, you'll use the FX Transfer flow."* No link to FX Transfer in KZO-179 (KZO-168 hasn't shipped; linking to a 404 is bad UX). KZO-168 will wire the link when FX Transfer ships. i18n keys go to settings dictionary (en + zh-TW). Visual: established `bg-blue-50 text-blue-700` palette.
- **D7.** **`POST /accounts` response shape — bare `AccountDto`.** Matches existing `POST /fee-profiles` (registerRoutes.ts:2562) and `PATCH /accounts/:id` (registerRoutes.ts:2544) patterns. Fields exactly per current `AccountDto` (id, name, userId, feeProfileId, defaultCurrency, accountType). `createdAt` not in response (per D2).
- **D8.** **E2E coverage — one golden-path spec.** `apps/web/tests/e2e/specs/account-creation-aaa.spec.ts` (dev_bypass mode, suite 6). Arrange seeded user; act open drawer → Accounts tab → fill form (name `"USD Brokerage"`, type `Bank`, currency `USD`) → submit; assert new account appears in tab list, drawer-close, navigate `/cash-ledger`, dropdown shows both `Main (TWD · Broker)` and `USD Brokerage (USD · Bank)`. Edge cases (409 duplicate, validation rejection, fee-profile picker conditional render, error states) covered in HTTP/web-unit suites — NOT in E2E.
- **D9.** **Persistence write path — push + saveStore.** Mirror `POST /fee-profiles` pattern: route handler creates account with `randomUUID()`, pushes onto `store.accounts`, calls `app.persistence.saveStore(store)`. saveStore's `INSERT ... ON CONFLICT (id) DO UPDATE` (postgres.ts:2235) handles the new row; `created_at` (D2) gets `DEFAULT NOW()` on INSERT and is preserved on conflict (not in `DO UPDATE SET`). No new persistence method needed.
- **D10.** **Route registration in WRITER + WRITE_CONTEXT_GUARD sets.** `POST /accounts` MUST be added to BOTH `WRITER_ROLE_ROUTE_KEYS` (registerRoutes.ts:342) and `WRITE_CONTEXT_GUARD_ROUTE_KEYS` (line 380). Demo users may create accounts (consistent with their ability to write trades and fee profiles). Shared-context impersonation viewers 403 (consistent with every other portfolio CRUD route).
- **D11.** **Section rename when moving.** `apps/web/features/settings/components/AccountFallbackSection.tsx` → `AccountsListSection.tsx`. i18n keys `accountFallbackSectionTitle` / `accountFallbackSectionDescription` → `accountsListSectionTitle` / `accountsListSectionDescription` (en + zh-TW). The section now lives in the Accounts tab and represents "your accounts" generically — the "fallback" framing was Fees-tab-scoped.
- **D12.** **Drawer state refresh — parent callback.** Form-submit handler signature: `await createAccount(body); onAccountsRefresh(); resetForm();`. `onAccountsRefresh` is a parent-supplied callback (mirrors existing `onProfileUpdate` prop) that re-fetches `/accounts` and re-renders the drawer. Implementer wires this from the drawer parent (likely `AppShell` or wherever `SettingsDrawer` is mounted).
- **D13.** **Visual contract for the form** — implementer judgment within the chip-mockup precedent. Type pills use `lucide-react` icons (`Building2` for Broker, `Landmark` for Bank, `Wallet` for Wallet — pick from available inventory). Currency cards are button-style with `ring-2 ring-indigo-300` on selected state. Live-preview chip mirrors the established `formatAccountOption` style from `apps/web/features/cash-ledger/utils/accountOptions.ts` — re-export or import the helper rather than duplicating logic. Tab strip wrap behavior verified visually on narrow viewports during implementation (existing 5-tab strip already wraps; 6 doesn't change semantics fundamentally).

## Out of scope (explicit)

- **KZO-180** — user-level reporting currency: `user_preferences.reportingCurrency` JSONB key + dashboard / portfolio-summary FX-aware read consumers + settings UI.
- **KZO-181** — `FeeProfile` / `FeeProfileBinding` mirror cleanup investigation.
- **KZO-168** — FX Transfer producer side (cash-entry type, route, UI). Includes wiring the callout link (D6) when FX Transfer ships.
- **KZO-170 / KZO-171** — US / AU market broker-account behavioral semantics on `account_type`.
- **`account_type` behavioral gating** — bank/wallet accounts continue to accept the same entry types and trade events as broker accounts (per KZO-167 D4). Behavioral semantics defer to downstream tickets that have product reasons.
- **Account delete / archive** — no delete UI, no `DELETE /accounts/:id` endpoint. Deferred until a product need arises.
- **Multi-currency account support** — single-currency-per-account is a locked invariant (per KZO-167 D7 lockdown).
- **`createdAt` on `AccountDto`** — column exists in DB after migration 041, but not exposed on the read DTO. Future tickets may promote it if a UI needs sort-by-creation, audit display, etc.
- **`AccountDto` `updatedAt`** — same reasoning. Not added in this ticket.
- **Audit-log entry on create / update / delete** — explicitly rejected (D2). `created_at` is the forensic replacement.
- **Account count cap / rate limit** — explicitly deferred (D4).
- **Sharing-view changes** — no current account-scoped sharing surface (per KZO-167 D6).
- **Other UI surfaces showing the new chip** — the transactions page, dashboard, etc. continue showing raw account IDs. Only `/cash-ledger` (KZO-167) and the new Accounts tab (KZO-179) render the `name (currency · type)` chip.

## Acceptance criteria mapping

| Ticket AC | Where satisfied |
|---|---|
| `POST /accounts` body `{ name, defaultCurrency, accountType, feeProfileId? }` with Zod validation | D9, Phase 2 step (route handler) |
| Default `feeProfileId` to user's default fee profile if omitted | D5, Phase 2 step (resolution helper) |
| Account-name uniqueness check (per-user) | D3, Phase 1 (DB index) + Phase 2 (route pre-check + isUniqueViolation catch) + Phase 7 test (Postgres-only per `test-placement-persistence-backend.md`) |
| ~~Audit log entry on creation~~ | **Rejected (D2).** Replaced by `created_at` column. |
| Return shape: full `AccountDto` | D7, Phase 2 step |
| Account creation form per mockup #4 | D1, Phase 4 step (mockup #4 not findable in repo; visual contract mirrors KZO-167 chip mockup per D13) |
| Page route TBD (settings/accounts or modal launched from /cash-ledger) | D1, **resolved**: Accounts tab in existing settings drawer |
| DTO write contracts: extend `libs/shared-types` if needed | Not needed — `AccountDto` already has all required fields after KZO-167. New ticket-internal types (e.g., `CreateAccountInput` Zod-derived) live in `apps/api/src/routes/registerRoutes.ts` only. |
| HTTP + E2E test coverage | Phase 7 (HTTP suite 8 + Postgres integration suite 5 + web unit suite 3 + E2E suite 6) |

## Implementation Steps

### Phase 1 — Migration

- [ ] Create `db/migrations/041_kzo179_account_created_at_and_name_uniqueness.sql`. Idempotent. Steps:
  1. `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`
  2. `CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_id_name ON accounts(user_id, name);`
  3. Comment block at the top: KZO-179 reference + note that existing rows backfill to migration-run time, accepted as forensic floor.
- [ ] Extend `apps/api/test/integration/postgres-migrations.integration.test.ts`:
  - Assert `accounts.created_at` column exists, NOT NULL, DEFAULT `now()`.
  - Assert index `ux_accounts_user_id_name` exists with the correct columns.

### Phase 2 — API route + persistence

- [ ] Add `POST /accounts` handler in `apps/api/src/routes/registerRoutes.ts` (place alongside the existing GET/PATCH `/accounts` block at line 2479+). Shape:
  ```ts
  app.post("/accounts", async (req) => {
    const body = z.object({
      name: z.string().trim().min(1).max(80),
      defaultCurrency: z.enum(["TWD", "USD", "AUD"]),
      accountType: z.enum(["broker", "bank", "wallet"]),
      feeProfileId: userScopedIdSchema.optional(),
    }).parse(req.body);

    const { store } = await loadUserStore(app, req);

    // Pre-check (clean 409 UX before TOCTOU safety net)
    if (store.accounts.some((a) => a.name === body.name)) {
      throw routeError(409, "account_name_in_use", "An account with that name already exists.");
    }

    // Resolve fee-profile (per D5 cascade)
    const resolvedFeeProfileId =
      body.feeProfileId !== undefined ? body.feeProfileId :
      store.feeProfiles.find((p) => p.id === defaultFeeProfileId(store.userId))?.id ??
      store.feeProfiles[0]?.id;
    if (!resolvedFeeProfileId) throw routeError(500, "no_fee_profile_available", "No fee profile available for the user.");
    if (body.feeProfileId !== undefined) requireProfile(store, body.feeProfileId);

    const account: AccountDto = {
      id: randomUUID(),
      userId: store.userId,
      name: body.name,
      feeProfileId: resolvedFeeProfileId,
      defaultCurrency: body.defaultCurrency,
      accountType: body.accountType,
    };
    store.accounts.push(account);

    try {
      await app.persistence.saveStore(store);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw routeError(409, "account_name_in_use", "An account with that name already exists.");
      }
      throw err;
    }

    return account;
  });
  ```
  Verify: `requireProfile`, `userScopedIdSchema`, `defaultFeeProfileId`, `isUniqueViolation`, `loadUserStore`, `routeError`, `randomUUID`, `AccountDto` imports (most already present in this file from KZO-167).
- [ ] Register the new route key (D10):
  - Append `"POST /accounts"` to `WRITER_ROLE_ROUTE_KEYS` (registerRoutes.ts:342).
  - Append `"POST /accounts"` to `WRITE_CONTEXT_GUARD_ROUTE_KEYS` (registerRoutes.ts:380).
- [ ] Verify `isUniqueViolation` is exported from `apps/api/src/persistence/postgres.ts`. If not, export it (one-line change).
- [ ] No persistence-method addition needed (D9 — saveStore upsert handles new rows).

### Phase 3 — Settings drawer Accounts tab + tab strip

- [ ] In `apps/web/components/settings/SettingsDrawer.tsx`:
  - Add new tab key `"accounts"` to the form-tab union type.
  - Add a 6th `<Button>` to the tab strip (mirror lines 94–143 pattern). Position between Fees and Tickers (so the order is Profile / General / Fees / **Accounts** / Tickers / Display) — keeps account/fee tabs adjacent.
  - Add a new conditional render block for `form.tab === "accounts"` that renders (in order): the new `<AccountCreateForm>` (Phase 4) + the relocated `<AccountsListSection>` (Phase 4).
  - Remove the `<AccountFallbackSection>` render from the existing Fees tab block (lines 235ish).
  - Update `useSettingsForm` hook if it persists the active tab — add `"accounts"` to allowed values.
- [ ] Add i18n keys to `apps/web/lib/i18n/types.ts` (or wherever `AppDictionary.settings` lives):
  - `tabAccounts` (en: `"Accounts"`, zh-TW: `"帳戶"`)
  - `accountsListSectionTitle` (replaces `accountFallbackSectionTitle`)
  - `accountsListSectionDescription` (replaces `accountFallbackSectionDescription`)
  - `accountCreateTitle` (en: `"Add account"`, zh-TW: `"新增帳戶"`)
  - `accountCreateNameLabel` (en: `"Name"`, zh-TW: `"名稱"`)
  - `accountCreateNamePlaceholder` (en: `"e.g. USD Brokerage"`, zh-TW: `"例：美元券商"`)
  - `accountCreateTypeLabel` (en: `"Type"`, zh-TW: `"類型"`)
  - `accountCreateCurrencyLabel` (en: `"Currency"`, zh-TW: `"幣別"`)
  - `accountCreateFeeProfileLabel` (en: `"Fee profile"`, zh-TW: `"費率組合"`) — only rendered when shown (D5)
  - `accountCreateCurrencyLockBody` (en per D6; zh-TW: `"每個帳戶使用單一幣別。日後若要在幣別之間移動資金，請使用 FX Transfer 流程。"`)
  - `accountCreatePreviewLabel` (en: `"Preview"`, zh-TW: `"預覽"`)
  - `accountCreateSubmit` (en: `"Add account"`, zh-TW: `"新增帳戶"`)
  - `accountCreateNameInUseError` (en: `"An account with that name already exists."`, zh-TW: `"已有相同名稱的帳戶。"`)
  - `accountCreateGenericError` (en: `"Could not create account. Please try again."`, zh-TW: `"無法新增帳戶，請再試一次。"`)
- [ ] Update `apps/web/features/settings/i18n.ts` (en + zh-TW) — add the new keys; rename the two existing ones.
- [ ] Update every callsite of the old i18n keys (`accountFallbackSectionTitle`, `accountFallbackSectionDescription`) — should be one or two sites in `AccountFallbackSection.tsx` itself (which we're renaming).

### Phase 4 — Components

- [ ] Rename file: `apps/web/features/settings/components/AccountFallbackSection.tsx` → `AccountsListSection.tsx`. Rename the exported component too. Update the import in `SettingsDrawer.tsx`.
- [ ] Create `apps/web/features/settings/components/AccountCreateForm.tsx`. Props:
  ```ts
  interface AccountCreateFormProps {
    feeProfiles: FeeProfileDto[];
    onCreate: (input: CreateAccountInput) => Promise<void>;
    onAccountsRefresh: () => void;
    dict: AppDictionary;
  }
  ```
  Behavior (D5, D6, D12, D13):
  - Controlled inputs: `name`, `accountType`, `defaultCurrency`, `feeProfileId` (only used when picker shown).
  - Type pills (Broker / Bank / Wallet) using `lucide-react` icons (Building2 / Landmark / Wallet).
  - Currency cards (TWD / USD / AUD) with `ring-2 ring-indigo-300` on selected.
  - Fee-profile picker rendered only when `feeProfiles.length > 1`.
  - Info-blue callout (`bg-blue-50 text-blue-700`) with `accountCreateCurrencyLockBody` text.
  - Live-preview chip — import `formatAccountOption` from `apps/web/features/cash-ledger/utils/accountOptions.ts` (already extracted helper) and render against the chip-styled container; falls back to placeholder when name is empty.
  - Submit button disabled when `name.trim() === ""`.
  - On submit: `await onCreate(input); onAccountsRefresh(); resetForm();`. On error: show inline error message (use `accountCreateNameInUseError` for 409, `accountCreateGenericError` otherwise).
- [ ] Per `nextjs-i18n-serialization.md` — i18n dictionary stays string-only; `formatAccountOption` and any other formatters live OUTSIDE the dict (already extracted to `accountOptions.ts` per KZO-167 — reuse, do not duplicate).

### Phase 5 — Web service + hook plumbing

- [ ] Add `createAccount(body)` to the existing settings or accounts service (likely a new function alongside `fetchAccounts` in `apps/web/features/cash-ledger/services/cashLedgerService.ts`, or a new `apps/web/features/settings/services/accountsService.ts` — implementer judgment based on co-location). Shape:
  ```ts
  export async function createAccount(input: CreateAccountInput): Promise<AccountDto> {
    return postJson<AccountDto>("/accounts", input);
  }
  ```
- [ ] Wire `onAccountsRefresh` from `SettingsDrawer` parent. The drawer parent (likely `AppShell` — verify by grep) currently passes `accounts: AccountDto[]` and `onProfileUpdate: () => void` props. Add a sibling `onAccountsRefresh: () => void` that re-fetches `/accounts` (or refreshes whatever store the parent uses for accounts). Mirror the `onProfileUpdate` pattern exactly.
- [ ] If there is no `WebEnv` env access added in this ticket, no changes to `libs/config/src/env-web.ts` (per `config-web-env-pattern.md` — only relevant when adding new env vars; we are not).

### Phase 6 — Test API extension

- [ ] Add `create` method to `libs/test-api/src/endpoints/AccountsEndpoint.ts`:
  ```ts
  create = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/accounts"), { data, ...(headers ? { headers } : {}) });
  ```
- [ ] Add `createAccount(data)` to `libs/test-api/src/assistants/accounts/AccountsApiActions.ts`:
  ```ts
  @Step()
  async createAccount(data: unknown): Promise<APIResponse> {
    return this._instance.create(data, this.authHeaders);
  }
  ```
- [ ] No mapper registration changes needed — `AccountsEndpoint` is already in `libs/test-api/src/config/mapper.ts:36` (per `test-api-mapper-registration.md`, this no-op is intentional).

### Phase 7 — Tests

- [ ] **Unit (suite 4 — `apps/api`):** if a fee-profile resolution helper is extracted from the route handler, unit-test it in `apps/api/test/unit/account-creation-helpers.test.ts`. If the resolution stays inline in the route (small enough), skip — covered by HTTP tests.
- [ ] **Integration (suite 5 — Postgres) — `apps/api/test/integration/account-creation-uniqueness.integration.test.ts`** (new file) per `integration-test-persistence-direct.md`:
  - Use `PostgresPersistence` directly (NOT `buildApp({ persistenceBackend: "postgres" })`).
  - Seed real user via `resolveOrCreateUser` (per `integration-test-persistence-direct.md` "seed real users for any path that writes to audit_log" — even though we don't audit-log, the FK rules around user_id still apply on a real DB).
  - Test: `POST /accounts { name: "Main", ... }` → 409 `account_name_in_use` (default seed already named "Main").
  - Test: two concurrent `POST /accounts` with same name (simulate via direct-INSERT race or paired client) → one succeeds, one returns 409 via the `isUniqueViolation` safety-net catch (TOCTOU).
  - Test: column / index existence per Phase 1 — folded into `postgres-migrations.integration.test.ts` instead.
- [ ] **HTTP (suite 8 — `test:http`) — `apps/api/test/http/specs/account-creation-aaa.http.spec.ts`** (new file):
  - Happy path: `POST /accounts { name: "USD Brokerage", defaultCurrency: "USD", accountType: "bank" }` → 200, body matches `AccountDto` shape with the new id, `feeProfileId` populated to user's default.
  - Default fee-profile resolution: omit `feeProfileId` → response includes the user's default profile id.
  - Explicit fee-profile: provide `feeProfileId: <user's profile>` → response includes that id.
  - Validation: empty name → 400; name > 80 chars → 400; `defaultCurrency: "EUR"` → 400; `accountType: "savings"` → 400; missing `defaultCurrency` → 400.
  - Subsequent GET `/accounts` reflects the new account.
  - **NOTE**: 409 duplicate-name test goes in suite 5 (integration), NOT here, because the HTTP suite uses `MemoryPersistence` and won't enforce uniqueness (per `test-placement-persistence-backend.md`). HTTP test asserts the route 200s for happy path only.
- [ ] **Web unit (suite 3 — `apps/web`) — `apps/web/test/features/settings/AccountCreateForm.test.tsx`** (new file):
  - Renders all 4 base fields (name, type pills, currency cards, callout) when `feeProfiles.length === 1`.
  - Renders fee-profile picker when `feeProfiles.length > 1`.
  - Live-preview chip updates as name + type + currency change.
  - Submit button disabled when name is empty.
  - Submit calls `onCreate` with the resolved input; calls `onAccountsRefresh` after success.
  - Renders inline error on 409 ("name in use") and on generic 500.
- [ ] **E2E (suite 6 — `test:e2e:bypass:mem`) — `apps/web/tests/e2e/specs/account-creation-aaa.spec.ts`** (new file) per D8 + `e2e-aaa-guardrails.md`:
  - Single golden-path test using existing AAA POMs/fixtures.
  - Arrange: dev_bypass user, default `Main` (TWD/broker/Default Broker) account already seeded.
  - Act: open drawer → click Accounts tab → fill `name="USD Brokerage"`, click Bank pill, click USD card → click Submit.
  - Assert: drawer's Accounts tab list now includes both accounts; close drawer; navigate to `/cash-ledger`; account dropdown shows `Main (TWD · Broker)` and `USD Brokerage (USD · Bank)`.
  - **Reminder per `playwright-web-bundle-rebuild.md`:** any iteration on the form source between E2E re-runs MUST rebuild via `npm run test:e2e:bypass:mem` (the wrapper builds the standalone bundle). Direct `npx playwright test` with stale bundles will produce confusing failures.
- [ ] **Existing fixtures audit:** any fixture that constructs `AccountDto` literals already has `defaultCurrency` and `accountType` from KZO-167 — no changes needed.
- [ ] **Existing E2E audit grep:**
  ```bash
  grep -rn "AccountFallback\|accountFallbackSection\|settings-tab-fees.*account\|account-name-input\|account-rename" \
    apps/web/tests/e2e/specs apps/web/tests/e2e/specs-oauth apps/web/test
  ```
  Update any matches that reference the old section name / Fees-tab-scoped account selectors. Most likely there are existing E2E specs that open the Fees tab to rename an account — those need to switch to the Accounts tab.

### Phase 8 — Docs

- [ ] Append a transition note `docs/004-notes/kzo-179/transition-{datetime}-multi-account-creation.md` after merge per `doc-management.md`. Cover: behavioral changes (new POST /accounts route, new Accounts tab, AccountFallbackSection → AccountsListSection rename, removed from Fees tab), migration 041 (created_at floor + uniqueness index), no-ops (no audit-log entry, no createdAt on AccountDto, account_type still metadata-only), forward links (KZO-168 will wire FX Transfer link).
- [ ] No update to `docs/market-data-platform.md` needed (KZO-179 is portfolio-CRUD, not market-data).
- [ ] Update `## Locked Scope` on KZO-179 (done in this scope-grill session via Linear write-back).

### Phase 9 — Pre-PR / pre-push gates (reviewer checklist)

- [ ] Run the canonical pre-push gate per `full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [ ] Run `/code-reviewer` per `code-review-before-pr.md` and produce review doc at `docs/004-notes/kzo-179/review-{datetime}-iter1.md`.
- [ ] Verify reviewer-rule compliance:
  - `service-error-pattern.md` — `routeError(409, "account_name_in_use", ...)`, `routeError(500, "no_fee_profile_available", ...)` if used.
  - `migration-strategy.md` — new file 041 (next sequential), idempotent, `IF NOT EXISTS` guards, no edits to earlier migrations.
  - `interface-caller-verification.md` — grep `AccountFallbackSection`, `accountFallbackSection*` confirms zero remaining callers post-rename. Grep new `createAccount` confirms expected call sites only.
  - `test-placement-persistence-backend.md` — duplicate-name 409 test is Postgres-backed, not memory.
  - `integration-test-persistence-direct.md` — new integration test uses `PostgresPersistence` directly, NOT `buildApp({ persistenceBackend: "postgres" })`.
  - `nextjs-i18n-serialization.md` — i18n dictionaries stay string-only; `formatAccountOption` is reused from existing helper file.
  - `commit-format.md` — `feat(api,db,web): KZO-179: <subject>` shape.
  - `pr-bound-docs-review-compliance.md` — PR description has `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block listing all 8 suite results), `## Risk/Rollback`.
  - `playwright-web-bundle-rebuild.md` — E2E iteration uses npm wrapper.
  - `e2e-aaa-guardrails.md` — new spec uses 2-worker parallel; readiness markers; no `networkidle` (`playwright-navigation-patterns.md`).

## Open Items

None. All deferred items are tracked under sibling tickets (KZO-180, KZO-181, KZO-168, KZO-170, KZO-171) per the parent KZO-167 split.

## References

- Linear: KZO-179 (this ticket); KZO-167 (parent — landed schema + types + service guard); KZO-180, KZO-181, KZO-168, KZO-170, KZO-171 (siblings).
- Companion docs: `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md`, `docs/004-notes/kzo-167/transition-202604271800-account-currency-and-type.md`, `docs/004-notes/kzo-167/mockup-cash-ledger-chip.html` (visual contract reference for chip styling).
- Mockup: `docs/004-notes/kzo-179/mockup-202604272000-account-creation.html` + `.png` (this session — produced via `frontend-design`-style hand-authored Tailwind HTML, rendered to PNG via repo precedent script).
- Migration precedent: `db/migrations/040_kzo167_account_currency_and_type.sql` (CHECK enum constraint guard pattern; KZO-179 doesn't need DO $$ guards since it adds only a column with DEFAULT and a unique index).
