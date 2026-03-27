# Phase 5d — E2E Migration to AAA (Corrected)

**Date:** 2026-03-26
**Status:** Frozen snapshot — do not update after merge
**Origin:** Grill session on `automation-refactor` worktree (Phase 5d gap analysis)
**Predecessor:** [design-202603262033-aaa-framework-phase5-breakdown.md](design-202603262033-aaa-framework-phase5-breakdown.md)

---

## Corrections to predecessor

The predecessor doc's Phase 5d described "migrate remaining 8 dev-bypass specs." This was incorrect on two counts:

1. **Both suites migrate to AAA**, not just dev-bypass. `specs-oauth/` files also need AAA migration.
2. **5 API-only specs move to Phase 5e** instead — they have no page interaction and belong with the API integration test migration.

This document replaces Phase 5d in the predecessor.

---

## Scope

### Specs to AAA-migrate (10 total)

**`specs/` (5 specs):**

| # | Spec | Auth mode |
|---|------|-----------|
| 1 | `auth-oauth.spec.ts` | dev-bypass (tests OAuth flow mechanics) |
| 2 | `portfolio-transactions.spec.ts` | dev-bypass |
| 3 | `shell-navigation.spec.ts` | dev-bypass |
| 4 | `tooltips-a11y.spec.ts` | dev-bypass |
| 5 | `transaction-mutations.spec.ts` | dev-bypass |

**`specs-oauth/` (5 specs):**

| # | Spec | Auth mode |
|---|------|-----------|
| 6 | `auth-demo.spec.ts` | oauth |
| 7 | `auth-session.spec.ts` | oauth |
| 8 | `demo-symbol-history.spec.ts` | oauth |
| 9 | `profile-tab.spec.ts` | oauth |
| 10 | `routing.spec.ts` | oauth |

### Specs moved to Phase 5e (API-only, no page interaction)

| Spec | Suite | Reason |
|------|-------|--------|
| `specs/identity-resolution.spec.ts` | specs | Pure API — mints sessions, asserts via HTTP |
| `specs/sse-events.spec.ts` | specs | EventSource via `page.evaluate()`, no UI |
| `specs-oauth/auth-identity-source.spec.ts` | specs-oauth | `GET /settings` with headers, no browser |
| `specs-oauth/identity-resolution.spec.ts` | specs-oauth | `GET /settings` with cookie, no browser |
| `specs-oauth/sse-auth.spec.ts` | specs-oauth | EventSource with session auth, no browser UI |

### Deletions at end of 5d

| File | Reason |
|------|--------|
| `specs/settings.spec.ts` | Superseded by `settings-aaa.spec.ts` (dual-pair validation anchor — delete after all migrations verified) |
| `helpers/flows.ts` | All consumers migrated to AAA framework equivalents |
| `fixtures/test.ts` | Old fixture wrapping `flows.ts`; replaced by AAA base fixture chain |

### File moves

| File | From | To | Notes |
|------|------|----|-------|
| `mock-oauth-server.mjs` | `helpers/` | `libs/test-e2e/` | Evaluate wrapping as Playwright fixture (`beforeAll` scope for mock server lifecycle) |

---

## flows.ts function mapping

Every `flows.ts` function has an AAA equivalent or a designated landing spot:

| flows.ts function | AAA equivalent | Location |
|---|---|---|
| `waitForAppReady` | `mxWaitForAppReady` | `test-framework` CoreMixin |
| `gotoRoute` | `mxNavigateToRoute` | `test-framework` ActionsMixin |
| `reloadRoute` | `mxReloadPage` | `test-framework` ActionsMixin |
| `openSettingsDrawer` | `openSettingsDrawer()` | `test-e2e` AppShellActions |
| `openMobileNavigation` | **new** `openMobileNavigation()` | `test-e2e` AppShellActions |
| `resetE2EUser` | `TestUser.reset()` | `test-framework` TestUser |
| `assignE2EUser` | `TestUser.assignIdentity()` | `test-framework` TestUser |
| `buildE2EUserId` | base fixture derivation | `test-e2e` fixtures/base.ts |
| `appUrl` | **new** standalone utility | `test-framework` |
| `apiUrl` | **new** standalone utility | `test-framework` |
| `extractCookieValue` | **new** standalone utility | `test-framework` |
| `TestEnv` (re-export) | direct import | `@tw-portfolio/config/test` |

---

## New POMs

### 6 new page object models

**1. LoginPage** (`/login`)

| Element | Test ID |
|---------|---------|
| googleSignInButton | `google-sign-in-button` |
| demoSignInButton | `demo-sign-in-button` |

Used by: auth-oauth, auth-demo, auth-session, routing

**2. AuthErrorPage** (`/auth/error`)

| Element | Test ID |
|---------|---------|
| tryAgainButton | `auth-error-try-again` |
| globalErrorBanner | `global-error-banner` |

Used by: auth-oauth, auth-session, routing

**3. DashboardPage** (`/dashboard`)

| Element | Test ID |
|---------|---------|
| recomputeButton | `recompute-button` |
| recomputeStatus | `recompute-status` |
| demoBanner | `demo-banner` |

Used by: portfolio-transactions, auth-demo

**4. PortfolioPage** (`/portfolio`)

| Element | Test ID |
|---------|---------|
| holdingsTable | `holdings-table` |
| portfolioIntro | `portfolio-intro` |

Used by: shell-navigation, transaction-mutations, demo-symbol-history

**5. TransactionsPage** (`/transactions`)

| Element | Test ID |
|---------|---------|
| transactionsIntro | `transactions-intro` |
| transactionStatus | `transaction-status` |
| verificationPanel | `transactions-verification-panel` |
| recentTransactionsCard | `recent-transactions-card` |
| recentTransactionsTable | `recent-transactions-table` |
| tooltipAccountTrigger | `tooltip-tx-account-trigger` |
| tooltipAccountContent | `tooltip-tx-account-content` |
| transactionForm | `TransactionFormComponent` (shared) |

Used by: portfolio-transactions, tooltips-a11y, sse-events

**6. TickerDetailPage** (`/tickers/:symbol`) — decomposed

Top-level elements:

| Element | Test ID |
|---------|---------|
| symbolHistorySection | `symbol-history-section` |
| symbolHistoryTitle | `symbol-history-title` |
| symbolHistoryEmpty | `symbol-history-empty` |
| transactionRow | `transaction-row` |
| editableTransactionRow | `editable-transaction-row` |
| mutationStatus | `mutation-status` |

Sub-components:

```
TickerDetailPage
├── deleteDialog: DeleteDialogComponent
│   ├── deleteTransactionButton    (delete-transaction-button)
│   ├── confirmationDialog         (delete-confirmation-dialog)
│   ├── tradeSummary               (delete-trade-summary)
│   ├── impactCounts               (delete-impact-counts)
│   ├── negativLotsWarning         (delete-negative-lots-warning)
│   └── confirmButton              (delete-confirm-button)
├── editForm: EditFormComponent
│   ├── editTransactionButton      (edit-transaction-button)
│   ├── quantityInput              (edit-quantity-input)
│   ├── priceInput                 (edit-price-input)
│   ├── sideSelect                 (edit-side-select)
│   ├── saveButton                 (edit-save-button)
│   ├── cancelButton               (edit-cancel-button)
│   ├── confirmationDialog         (edit-confirmation-dialog)
│   ├── negativLotsWarning         (edit-negative-lots-warning)
│   └── confirmButton              (edit-confirm-button)
└── recordDialog: TransactionFormComponent  ← shared with TransactionsPage
    ├── recordTransactionButton    (record-transaction-button)
    ├── recordTransactionDialog    (record-transaction-dialog)
    ├── symbolSelect               (tx-symbol-select)
    ├── accountSelect              (tx-account-select)
    ├── quantityInput              (tx-quantity-input)
    ├── priceInput                 (tx-price-input)
    ├── tradeDateInput             (tx-trade-date-input)
    └── submitButton               (tx-submit-button)
```

Used by: transaction-mutations, demo-symbol-history, shell-navigation

### 2 extensions to existing POMs

**7. TopBarComponent** (exists — add avatar menu items)

| Element | Test ID | Status |
|---------|---------|--------|
| avatarButton | `avatar-button` | exists |
| avatarMenuSettings | `avatar-menu-settings` | exists |
| avatarMenuIdentity | `avatar-menu-identity` | **new** |
| avatarMenuSignOut | `avatar-menu-sign-out` | **new** |

**8. SettingsDrawerPage** (exists — add profile tab)

| Element | Test ID | Status |
|---------|---------|--------|
| profileTab | `settings-tab-profile` | **new** |
| profileSection | `profile-section` | **new** |
| profileDisplayNameInput | `profile-display-name-input` | **new** |
| profileEmailInput | `profile-email-input` | **new** |
| profileSaveEmail | `profile-save-email` | **new** |
| profileEmailSaved | `profile-email-saved` | **new** |

### 1 new component on AppShellPage

**9. SearchComponent** (composed into AppShellPage)

| Element | Test ID | Mode |
|---------|---------|------|
| desktopSearch | `topbar-search` | desktop |
| desktopResults | `topbar-search-results` | desktop |
| mobileSearchButton | `topbar-search-button` | mobile |
| mobileSheet | `topbar-search-sheet` | mobile |
| mobileSheetInput | `topbar-search-sheet-input` | mobile |
| quickSearchItem | `quick-search-item-route-*` | both |

Used by: shell-navigation

---

## Migration ordering

Order determined by POM dependency chain. Auth specs first (thin POMs), then shell/navigation, then heavy transactional specs.

| Order | Spec | New POMs built | Depends on |
|-------|------|----------------|------------|
| 1 | `auth-demo.spec.ts` | LoginPage, DashboardPage | — |
| 2 | `auth-session.spec.ts` | AuthErrorPage | LoginPage (#1) |
| 3 | `auth-oauth.spec.ts` | — | LoginPage + AuthErrorPage (#1-2) |
| 4 | `routing.spec.ts` | — | LoginPage + AuthErrorPage (#1-2) |
| 5 | `shell-navigation.spec.ts` | PortfolioPage, SearchComponent | AppShellPage (exists) |
| 6 | `tooltips-a11y.spec.ts` | — | SettingsDrawerPage (exists), TransactionsPage (needed) |
| 7 | `portfolio-transactions.spec.ts` | TransactionsPage, TransactionFormComponent | DashboardPage (#1) |
| 8 | `demo-symbol-history.spec.ts` | TickerDetailPage (partial — section + rows) | PortfolioPage (#5) |
| 9 | `transaction-mutations.spec.ts` | TickerDetailPage (full — delete/edit/record dialogs) | TickerDetailPage partial (#8) |
| 10 | `profile-tab.spec.ts` | SettingsDrawerPage profile extension | SettingsDrawerPage (exists) |

### Dual-pair verification strategy

For each migration:
1. Keep old spec alongside new AAA spec
2. Run both — verify same test logic and passing results
3. Delete old spec after verification

`settings.spec.ts` / `settings-aaa.spec.ts` is the established template for this pattern.

---

## Architecture decisions

### Serial mode constraints — dropped

`shell-navigation.spec.ts` and `transaction-mutations.spec.ts` currently run with `mode: "serial"` due to dev-server cold-start contention. The AAA base fixture provides per-test user isolation, eliminating data-level contention. With `workers: 2`, cold-start is a transient issue mitigated by route caching after the first hit.

**Decision:** Drop serial constraints during AAA migration. Re-add only if flakiness appears in CI.

### Shared TransactionFormComponent

The `tx-*` form fields (`tx-account-select`, `tx-submit-button`, `tx-quantity-input`, etc.) appear on both `/transactions` (TransactionsPage) and `/tickers/:symbol` (TickerDetailPage record dialog). A single `TransactionFormComponent` is shared between both POMs rather than duplicating locators.

### openMobileNavigation

Added to `AppShellActions` alongside existing `openSettingsDrawer()`. Clicks `mobile-nav-toggle`, asserts `mobile-sidebar` visible.

### Standalone utilities in test-framework

`appUrl(path)`, `apiUrl(path)`, and `extractCookieValue(header, name)` are pure functions with no page interaction. They move to `libs/test-framework/` as standalone utilities rather than mixins or POM methods.

---

## Gap analysis (post-design review)

Reviewed 2026-03-26 by cross-referencing every claim against the codebase. Gaps ordered by severity.

### GAP-1 (High): Serial mode decision incomplete for `transaction-mutations.spec.ts`

The "Serial mode constraints — dropped" decision above treats both serial specs the same. They have different reasons for serial:

- `shell-navigation.spec.ts` — serial for **cold-start contention** (comment in source). Per-test user isolation + route caching makes this safe to drop.
- `transaction-mutations.spec.ts` — serial for **intentional intra-describe data dependencies** (create → edit → delete mutation chains within the same `describe` block). Per-test user isolation does not help when tests within a serial block deliberately share state from prior tests.

**Action:** Distinguish per-spec. For `transaction-mutations`, either:
1. Restructure tests to be fully independent (each test seeds its own data, no ordering dependency), or
2. Keep `mode: "serial"` within mutation-chain describes and document why it's intentional, not a workaround.

### GAP-2 (High): `edit-confirm-button` test ID missing from React source

The TickerDetailPage POM lists `edit-confirm-button` (EditFormComponent → confirmButton), and `transaction-mutations.spec.ts` references it. However, `EditConfirmationDialog.tsx` does not render a `data-testid="edit-confirm-button"` element.

**Action:** Before building the EditFormComponent POM, verify:
1. Does the dialog use a generic confirm button without a dedicated test ID?
2. Was the test ID removed/renamed since the spec was written?
3. Is the spec currently passing (suggesting the locator resolves via a different mechanism)?

If the test ID doesn't exist, either add it to the React component or update the POM design to use the actual locator.

### GAP-3 (Medium): `test` fixture export unmapped in flows.ts mapping table

`fixtures/test.ts` exports `{ test, expect }` — a custom Playwright `test` fixture that wraps `waitForAppReady` into the page fixture and wires `e2eUserId` via `assignE2EUser`/`resetE2EUser`/`buildE2EUserId`. 8 of the 10 specs import from this file. The mapping table above covers all `flows.ts` functions but omits the `test` fixture itself, even though the file is listed for deletion.

**Action:** Add row to the mapping table:

| fixtures/test.ts export | AAA equivalent | Location |
|---|---|---|
| `test` (extended fixture) | `createWebFixture` chain | `test-e2e` fixtures/base.ts → appShell.ts → settings.ts |
| `expect` | direct import | `@playwright/test` |

### GAP-4 (Low): specs-oauth/ uses 3 different fixture patterns

The migration ordering treats all specs-oauth/ files uniformly, but they currently use three different fixture bases:

| Fixture | Specs using it |
|---------|---------------|
| `@playwright/test` (no custom fixture) | `auth-demo.spec.ts` |
| `../fixtures/demo-test` | `demo-symbol-history.spec.ts` |
| `../fixtures/oauth-base` | `auth-session`, `profile-tab`, `routing` |

**Action:** Note the current fixture origin per spec in the migration ordering table so the AAA equivalent can be correctly wired. The `demo-test` fixture seeds a demo session via `/__e2e/demo-session` — this needs an AAA fixture variant or a TestUser method.

### GAP-5 (Low): SSE specs classification imprecise

`sse-events.spec.ts` and `sse-auth.spec.ts` are classified as "API-only, no page interaction" but they use `page.evaluate()` to create EventSource — they require a browser page as a transport mechanism. Zero test IDs, zero DOM assertions, but not truly API-only.

**Action:** Reframe in Phase 5e scope as "browser-mediated API tests" rather than "no page interaction." This affects whether they can be ported to pure `fetch()`-based tests or must remain Playwright-hosted.

### GAP-6 (Low): `quick-search-item-route-*` test ID pattern hides two-part structure

The actual source renders `quick-search-item-${item.kind}-${item.id}` (e.g., `quick-search-item-route-portfolio`). The doc's `quick-search-item-route-*` is correct for current usage (`kind` is always `route`), but the POM should use the two-part structure `quick-search-item-${kind}-${id}` to support non-route search items if added later.

**Action:** Build the SearchComponent POM locator as `quickSearchItem(kind: string, id: string)` rather than hardcoding the `route-` prefix.

---

## Not in scope (remains in other phases)

- Phase 5c owns OAuth parallelization (`oauth-base` fixture, retire `auth.setup.ts`, `fullyParallel: true`)
- Phase 5e owns API-only E2E specs (5 specs) + Category A integration test migration
- Phase 5f owns skill/rule promotion
