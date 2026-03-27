# Phase 5d Code Review — TDD Fix List

**Date:** 2026-03-27
**Status:** Frozen snapshot — do not update after merge
**Origin:** Code review of `automation-refactor` worktree (Phase 5d AAA migration)
**Predecessor:** [design-202603262345-aaa-framework-phase5d-e2e-migration.md](design-202603262345-aaa-framework-phase5d-e2e-migration.md)

---

## How to use this list

Work top-down. Each item is a self-contained fix. After each fix:

1. Run the relevant validation command
2. Confirm green
3. Check off the item
4. Move to the next

Validation commands:

```bash
# Typecheck (catches import/type regressions)
npm run typecheck

# Lint
npx eslint .

# Standard E2E (dev-bypass mode)
npm run test:e2e:bypass:mem --prefix apps/web

# OAuth E2E
npm run test:e2e:oauth:mem --prefix apps/web
```

---

## Critical — Fix first

### CR-1: Extract duplicate fixture base setup to shared factory

**Problem:** `e2eUserId`, `testUser`, `createTestUser` fixtures are copy-pasted across 4 files (~60 lines duplicated).

**Files:**
- `libs/test-e2e/src/fixtures/base.ts:23-52`
- `libs/test-e2e/src/fixtures/oauthBase.ts:39-57`
- `libs/test-e2e/src/fixtures/demoBase.ts:33-51`
- `libs/test-e2e/src/fixtures/noAuthBase.ts:15-33`

**Fix:** Extract a shared fixture factory in `shared.ts` parameterized by `seedIdentity: boolean`. The only behavioral difference is whether `testUser.reset()` + `assignIdentity()` is called (base.ts does, the other three don't).

**Validate:** `npm run typecheck && npx eslint .` then both E2E suites.

- [x] Done

---

### CR-2: Move app-specific test IDs out of generic test-framework

**Problem:** `test-framework` is supposed to be app-agnostic, but `CoreMixin` hardcodes app-specific test IDs (`app-shell-ready`, `app-shell-client-ready`, `global-error-banner`, `topbar-title`). `AssertMixin.mxAssertNoGlobalError()` also hardcodes `global-error-banner`.

**Files:**
- `libs/test-framework/src/mixins/CoreMixin.ts:14-30` — `mxWaitForShellClientReady`, `mxWaitForAppReady`
- `libs/test-framework/src/mixins/AssertMixin.ts:173-175` — `mxAssertNoGlobalError`

**Fix:** Two options (pick one):
- **(a)** Move these methods to `test-e2e` as app-specific helpers/mixins that extend the framework base.
- **(b)** Make the test IDs configurable via a config object passed at construction.

Option (a) is simpler and matches the existing layering: `test-framework` = generic, `test-e2e` = app-specific.

**Validate:** `npm run typecheck` — all consumers still compile. Both E2E suites green.

- [x] Done

---

### CR-3: Consolidate `private get el()` into base mixin

**Problem:** Every assistant that accesses POM elements defines an identical getter (12+ copies):

```typescript
private get el() { return this._instance.elements; }
```

**Files (all have the same getter):**
- `libs/test-e2e/src/assistants/auth/LoginAssert.ts:10`
- `libs/test-e2e/src/assistants/dashboard/DashboardAssert.ts:10`
- `libs/test-e2e/src/assistants/layout/AppShellAssert.ts:10`
- `libs/test-e2e/src/assistants/layout/AppShellActions.ts:12`
- `libs/test-e2e/src/assistants/portfolio/PortfolioAssert.ts:10`
- `libs/test-e2e/src/assistants/portfolio/PortfolioActions.ts:10`
- `libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts:11`
- `libs/test-e2e/src/assistants/tickers/TickerDetailAssert.ts:10`
- `libs/test-e2e/src/assistants/transactions/TransactionsAssert.ts:10`
- `libs/test-e2e/src/assistants/transactions/TransactionsActions.ts:10`
- `libs/test-e2e/src/assistants/settings/SettingsAssert.ts:10`
- `libs/test-e2e/src/assistants/settings/SettingsArrange.ts:9`
- `libs/test-e2e/src/assistants/dashboard/DashboardActions.ts:10`

**Fix:** Add `protected get el()` to the `BaseAssert`, `BaseActions`, and `BaseArrange` base classes in `libs/test-framework/src/mixins/index.ts` (or the mixin that defines `_instance`). Then remove all 12+ local copies.

**Validate:** `npm run typecheck` — all assistants compile without local `el`. Both E2E suites green.

- [x] Skipped — **by design (TypeScript constraint)**

**Why this cannot be consolidated:** Each assistant narrows `_instance` via `declare protected readonly _instance: SpecificPage`. The per-assistant `get el()` is defined in the subclass where `this._instance` resolves to the narrowed type, so `el` returns the specific elements type (`AppShellElements`, `DashboardElements`, etc.). Moving the getter to a base class (`TestAAA`, `BaseActions`, etc.) where `_instance: BasePage<unknown>` makes it return `unknown` — all 13 assistants lose type safety on element access like `this.el.topBar.elements.avatarButton`. TypeScript resolves getter return types at definition site, not call site; `declare` in a subclass only narrows direct property access, not inherited getters. The 1-line getter is the correct TypeScript pattern for type-safe access with `declare`-narrowed instance types.

---

## High — Fix next

### HI-1: Remove assertion from Arrange boundary

**Problem:** `TickerDetailArrange.seedTrade()` uses `expect(res.ok()).toBeTruthy()` — assertions belong in Assert, not Arrange.

**File:** `libs/test-e2e/src/assistants/tickers/TickerDetailArrange.ts:47`

**Fix:** Replace with a descriptive error throw:
```typescript
if (!res.ok()) throw new Error(`seedTrade failed: ${res.status()} ${await res.text()}`);
```

**Validate:** `npm run typecheck && npm run test:e2e:bypass:mem --prefix apps/web` (transaction-mutations-aaa.spec.ts exercises seedTrade).

- [x] Done

---

### HI-2: Standardize interaction API across assistants

**Problem:** Three different interaction APIs used interchangeably:

| API | Example | Where |
|---|---|---|
| Framework mixin | `this.mxNavigateToRoute()` | LoginActions:25, DashboardActions:16 |
| Direct page | `this.page.getByRole().click()` | TickerDetailActions:120 |
| uiActions helper | `this.uiActions.click.perform()` | TickerDetailActions:34 |

**Files with direct `this.page` usage that should use mixins or uiActions:**
- `libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts:120` — `cancelDelete()` uses `this.page.getByRole("button", { name: /cancel/i }).click()`
- `libs/test-e2e/src/assistants/auth/LoginAssert.ts:51` — `demoExpiredMessageIsVisible()` uses `this.page.getByText()`
- `libs/test-e2e/src/assistants/layout/AppShellAssert.ts:94` — uses `this.page.getByRole()`

**Fix:** For locator-based interactions, delegate to POM elements. For page-level operations (navigate, fill, click), use framework mixins. Direct `this.page` only for cases where no mixin or POM element exists.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [x] Done

---

### HI-3: Move `TransactionFormComponent` to shared location

**Problem:** `TickerDetailPage.ts:4` imports `TransactionFormComponent` from `../transactions/` — cross-module dependency. The component is used by both TransactionsPage and TickerDetailPage.

**Files:**
- `libs/test-e2e/src/pages/tickers/TickerDetailPage.ts:4` — import
- `libs/test-e2e/src/pages/transactions/TransactionFormComponent.ts` — definition
- `libs/test-e2e/src/pages/transactions/TransactionsPage.ts:27` — usage

**Fix:** Move to `libs/test-e2e/src/pages/shared/TransactionFormComponent.ts`. Update imports in both consumers and barrel exports.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [x] Done

---

### HI-4: Extract AssertMixin timeout helper

**Problem:** `timeout === undefined ? undefined : { timeout }` repeated 8 times in AssertMixin.

**File:** `libs/test-framework/src/mixins/AssertMixin.ts` — lines 18, 23, 28, 39, 51, 65, 78, 83

**Fix:** Extract private helper:
```typescript
private timeoutOpt(timeout?: number) {
  return timeout === undefined ? undefined : { timeout };
}
```
Replace all 8 call sites.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [x] Done

---

### HI-5: Extract `makeDeterministicIdToken` to shared utility

**Problem:** Identical JWT fabrication function duplicated in two AAA specs. A third variant exists in a non-migrated spec.

**Files:**
- `apps/web/tests/e2e/specs-oauth/auth-session-aaa.spec.ts:3-20`
- `apps/web/tests/e2e/specs-oauth/profile-tab-aaa.spec.ts:3-20`
- `apps/web/tests/e2e/specs/identity-resolution.spec.ts:7-22` (similar `makeFakeIdToken`)

**Fix:** Create `libs/test-e2e/src/utils/jwt.ts` with the shared implementation. Export from `libs/test-e2e/src/utils/index.ts`. Update spec imports.

**Validate:** `npm run typecheck`. OAuth E2E suite green.

- [x] Done

---

## Medium — Clean up

### ME-1: Eliminate dual fixture path ambiguity

**Problem:** Single-fixture files (`appShell.ts`, `settings.ts`, `dashboard.ts`, `portfolio.ts`, `tickers.ts`, `transactions.ts`) duplicate what `appPages.ts` already provides. Two import paths reach the same fixture.

**Files:**
- `libs/test-e2e/src/fixtures/appShell.ts`
- `libs/test-e2e/src/fixtures/settings.ts`
- `libs/test-e2e/src/fixtures/dashboard.ts`
- `libs/test-e2e/src/fixtures/portfolio.ts`
- `libs/test-e2e/src/fixtures/tickers.ts`
- `libs/test-e2e/src/fixtures/transactions.ts`
- `libs/test-e2e/src/fixtures/appPages.ts` (canonical bundle)

**Fix:** If no spec imports the individual files, delete them and keep only `appPages.ts`. If some specs use individual imports, consolidate to `appPages.ts` imports.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [ ] Done

---

### ME-2: Standardize page import paths in fixtures

**Problem:** Mixed import conventions — some use index barrels, others use direct file paths.

**Examples:**
- `appPages.ts:9` — `from "../pages/dashboard/index.js"` (barrel)
- `login.ts:4` — `from "../pages/auth/LoginPage.js"` (direct)

**Fix:** Standardize on barrel imports (`from "../pages/auth/index.js"`) consistently across all fixture files.

**Validate:** `npm run typecheck`.

- [ ] Done

---

### ME-3: Remove business logic from `SideNavigationComponent.link()`

**Problem:** POM contains a switch statement mapping destination names to locators — business logic that belongs in an assistant.

**File:** `libs/test-e2e/src/pages/layout/SideNavigationComponent.ts:35-44`

**Fix:** Replace `link(destination)` with individual locator properties: `dashboardLink`, `portfolioLink`, `transactionsLink`. Update consumers in AppShellActions.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [ ] Done

---

### ME-4: Extract `global-error-banner` to shared constant

**Problem:** Same test ID string defined in 3 POMs independently.

**Files:**
- `libs/test-e2e/src/pages/layout/AppShellPage.ts:30`
- `libs/test-e2e/src/pages/auth/AuthErrorPage.ts:13`
- `libs/test-e2e/src/pages/auth/BrowserSessionPage.ts:11`

**Fix:** Define `SHARED_TEST_IDS.globalErrorBanner` in a constants file (`libs/test-e2e/src/pages/constants.ts`) or extract a `GlobalErrorComponent` shared POM.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [ ] Done

---

### ME-5: Remove auto-call from mapper registration

**Problem:** `mapper.ts:41` calls `registerTestE2EAssistants()` at module import time — silent side effect.

**File:** `libs/test-e2e/src/config/mapper.ts:41`

**Fix:** Remove the auto-call. Have `shared.ts` (or fixture base) explicitly call `registerTestE2EAssistants()`.

**Validate:** Both E2E suites green (registration still happens via fixture import chain).

- [ ] Done

---

### ME-6: Add reset mechanism for `warmedAppRoutes`

**Problem:** Module-level `Set` persists across test files within the same worker. No `_reset*` helper exists (violates the `vitest-module-state-isolation` rule pattern).

**File:** `libs/test-e2e/src/fixtures/shared.ts:13`

**Fix:** Export a `_resetWarmedRoutes()` function for test isolation.

**Validate:** `npm run typecheck`.

- [ ] Done

---

## Low — Address at convenience

### LO-1: Replace `void request;` with `_request` prefix

**Files:** All 4 base fixtures (base.ts, oauthBase.ts, demoBase.ts, noAuthBase.ts) use `void request;` to suppress unused warnings.

**Fix:** Rename parameter to `_request` in destructuring.

- [ ] Done

---

### LO-2: Extract URL assertion helper in AssertMixin

**File:** `libs/test-framework/src/mixins/AssertMixin.ts:153-170`

`mxAssertUrlMatches` and `mxAssertUrlNotMatches` share nearly identical logic. Extract shared helper with `negate` parameter.

- [ ] Done

---

### LO-3: Document or remove empty Arrange classes

**Files:**
- `libs/test-e2e/src/assistants/dashboard/DashboardArrange.ts`
- `libs/test-e2e/src/assistants/portfolio/PortfolioArrange.ts`
- `libs/test-e2e/src/assistants/transactions/TransactionsArrange.ts`
- `libs/test-e2e/src/assistants/auth/AuthErrorArrange.ts`

These are empty shells. Either add a comment explaining they exist for framework interface compliance, or remove them if the framework doesn't require the class to exist.

- [ ] Done

---

### LO-4: Resolve tech debt comments (GAP-2, GAP-6)

- `libs/test-e2e/src/pages/tickers/EditFormComponent.ts:14` — GAP-2: `edit-confirm-button` may not exist in React source
- `libs/test-e2e/src/pages/layout/SearchComponent.ts:11` — GAP-6: `quickSearchItem(kind, id)` two-part structure

Verify against React components and either add missing test IDs or update the POM design.

- [ ] Done

---

## Phase 5e extraction opportunities

These items prepare reusable assets and reduce duplication ahead of the API test migration. Work them after the fixes above are green, or bundle into 5e scope.

### EX-1: Consolidate JWT test data factory (3 implementations)

**Problem:** Three independent JWT fabrication functions exist with overlapping logic.

**Files:**
- `apps/web/tests/e2e/specs-oauth/auth-session-aaa.spec.ts:3-20` — `makeDeterministicIdToken()`
- `apps/web/tests/e2e/specs-oauth/profile-tab-aaa.spec.ts:3-20` — `makeDeterministicIdToken()` (identical copy)
- `apps/web/tests/e2e/specs/identity-resolution.spec.ts:7-22` — `makeFakeIdToken()` (similar variant)

**Fix:** Create `libs/test-e2e/src/utils/jwt.ts` with a unified `makeTestIdToken(overrides?)` factory. Export from `libs/test-e2e/src/utils/index.ts`. Update all three call sites.

**Note:** HI-5 covers the two AAA specs. This item extends to the non-migrated spec as well, preparing it for 5e migration.

**Validate:** `npm run typecheck`. OAuth E2E suite green.

- [ ] Done

---

### EX-2: Extract shared OAuth state validation helpers

**Problem:** OAuth state parameter generation and validation logic duplicated across specs.

**Files:**
- `apps/web/tests/e2e/specs/auth-oauth-aaa.spec.ts:72-81` — state uniqueness assertion
- `apps/web/tests/e2e/specs/auth-oauth-aaa.spec.ts:277-281` — state segment count with returnTo
- `apps/web/tests/e2e/specs-oauth/routing-aaa.spec.ts:36-40` — returnTo threading through sign-in
- `apps/web/tests/e2e/specs-oauth/routing-aaa.spec.ts:85-111` — full returnTo roundtrip

**Fix:** Extract `parseOAuthState(stateParam)` and `assertOAuthStateShape(state, expectedSegments)` to `libs/test-e2e/src/utils/oauth.ts`. These will also serve 5e API tests that validate the OAuth protocol layer.

**Validate:** `npm run typecheck`. Both E2E suites green.

- [ ] Done

---

### EX-3: Consolidate duplicate SSE test flow pattern

**Problem:** Both SSE specs test the same core flow (open EventSource → publish via `/__test/publish-event` → assert delivery). Only the auth context differs.

**Files:**
- `apps/web/tests/e2e/specs/sse-events.spec.ts:11-42` — heartbeat + event delivery (no auth)
- `apps/web/tests/e2e/specs-oauth/sse-auth.spec.ts:6-54` — heartbeat + event delivery (OAuth session)

**Fix:** Extract a shared `publishAndExpectSseEvent(request, page, opts)` helper to `libs/test-e2e/src/utils/sse.ts` (alongside existing `openSseProbe`/`waitForSseProbeResult`). Parameterize auth context. When 5e migrates these to API tests, the helper moves with them.

**Validate:** Both E2E suites green.

- [ ] Done

---

### EX-4: Consolidate duplicate cookie/identity parsing

**Problem:** Cookie format parsing and userId extraction duplicated across 3 non-migrated specs.

**Files:**
- `apps/web/tests/e2e/specs/identity-resolution.spec.ts:34-46` — cookie format: `userId.hmac`
- `apps/web/tests/e2e/specs-oauth/identity-resolution.spec.ts:8-18` — same UUID validation
- `apps/web/tests/e2e/specs-oauth/auth-identity-source.spec.ts:14-34` — same cookie parsing

**Fix:** `libs/test-e2e/src/utils/cookie.ts` already has `extractCookieValue()`. Extend with `parseSessionCookie(raw): { userId, hmac }` and `assertUuidFormat(value)`. All three specs can delegate to the shared utility.

**Validate:** Both E2E suites green.

- [ ] Done

---

### EX-5: Classify SSE specs as "browser-mediated API tests" for 5e

**Problem:** The design doc (Phase 5d) classifies SSE specs as "API-only, no page interaction." This is imprecise — they use `page.evaluate()` to open EventSource, requiring a browser page as transport.

**Files:**
- `apps/web/tests/e2e/specs/sse-events.spec.ts` — uses `page.evaluate()` for EventSource
- `apps/web/tests/e2e/specs-oauth/sse-auth.spec.ts` — uses `page.evaluate()` + OAuth cookies

**Fix:** No code change. Update the 5e design doc to classify these as "browser-mediated API tests" rather than "no page interaction." This affects whether they can be ported to pure `fetch()`-based tests (they can't — EventSource requires a browser context) or must remain Playwright-hosted with a lightweight fixture.

- [ ] Done

---

## Phase 5e readiness — No blockers

All 5 non-migrated specs confirmed as API/protocol tests:

| Spec | Classification | Playwright role |
|---|---|---|
| `specs/identity-resolution.spec.ts` | JWT + cookie protocol | HTTP client only |
| `specs/sse-events.spec.ts` | Event delivery infra | Browser-mediated API |
| `specs-oauth/auth-identity-source.spec.ts` | Cookie vs header priority | HTTP client only |
| `specs-oauth/identity-resolution.spec.ts` | UUID format validation | HTTP client only |
| `specs-oauth/sse-auth.spec.ts` | SSE with OAuth session | Browser-mediated API |

**Reuse assets ready for 5e (after extraction items above):**
- `test-e2e/src/utils/cookie.ts` — cookie parsing + session format (EX-4)
- `test-e2e/src/utils/sse.ts` — SSE probe + publish-and-expect helper (EX-3)
- `test-e2e/src/utils/jwt.ts` — JWT test data factory (EX-1)
- `test-e2e/src/utils/oauth.ts` — OAuth state parsing + assertion (EX-2)
