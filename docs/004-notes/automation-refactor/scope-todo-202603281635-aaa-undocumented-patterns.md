# AAA Undocumented Patterns — 2026-03-28

Frozen snapshot from deep `/aaa:audit` analysis. Patterns observed in actual usage that are not yet covered by the architecture reference (`aaa-architecture.md`), rules, or skill definitions.

Each item describes the pattern as-is, where it was observed, and what should be documented.

---

## A1 — Multi-assistant coordination

12/19 AAA specs use 2-5 assistants per test (e.g., `login` + `session` + `dashboard`). This is the dominant usage pattern but completely undocumented.

**Examples:**
- `shell-navigation-aaa.spec.ts` — `appShell` + `portfolio` + `transactions` (3 assistants)
- `auth-session-aaa.spec.ts` — `dashboard` + `login` + `session` (3 assistants)
- `fee-profiles-aaa.http.spec.ts` — `feeProfilesApi` + `settingsApi` + `transactionsApi` (3 assistants)

**To document:**
- [ ] Add section to architecture reference: "Multi-Assistant Tests"
- [ ] When to use multiple assistants vs a single composite
- [ ] How cross-assistant state flows (one assistant's action produces state another asserts on)
- [ ] Upper limit guidance (recommendation: 3-4 max per test for readability)

---

## A2 — Interleaved act-assert for transactional verification

Complex API tests intentionally interleave: act -> assert status -> act -> assert status -> final assert. Valid for verifying atomicity and prerequisites, but contradicts linear Arrange->Act->Assert.

**Examples:**
- `fee-profiles-aaa.http.spec.ts:45-78` — create profile -> assert 200 -> update config -> assert 200 -> create transaction -> assert 200 -> delete -> assert 409
- `settings-aaa.http.spec.ts:63-102` — save invalid -> assert 400 -> GET after -> assert unchanged (atomicity check)
- `profile-api-aaa.http.spec.ts:53-65` — PATCH -> assert response -> GET -> assert persistence

**To document:**
- [ ] Add section to architecture reference: "Accepted AAA Variants"
- [ ] Interleaved act-assert: valid for multi-step transactional tests and atomicity verification
- [ ] Prerequisite verification: asserting an intermediate result before proceeding is not an anti-pattern
- [ ] Distinguish from scattered assertions (anti-pattern: random expect() sprinkled without purpose)

---

## A3 — Arrange vs Actions boundary for navigation

`page.goto()` appears in both Arrange and Actions classes. No documented heuristic for which phase owns navigation.

**Observed heuristic (not yet documented):**
- Navigation to the starting point = Arrange (e.g., `arrange.navigateToLogin()`)
- Navigation that IS the behavior under test = Actions (e.g., `actions.clickDashboardLink()`)

**Anti-pattern found:** `settings-aaa.spec.ts:41` calls `arrange.openFeesTab()` after actions have started, violating linearity.

**To document:**
- [ ] Document the heuristic in architecture reference (boundary rules section)
- [ ] Audit `settings-aaa.spec.ts:41` — likely should be `actions.openFeesTab()`

---

## A4 — POM composition (nested POMs in initializeElements)

Three POMs instantiate child POMs inside `initializeElements()`:
- `AppShellPage` — composes `TopBarComponent`, `SideNavigationComponent`, `SearchComponent`
- `TickerDetailPage` — composes `DeleteDialogComponent`, `EditFormComponent`, `TransactionFormComponent`
- `TransactionsPage` — composes `TransactionFormComponent`

`initializeElements()` was designed for locator initialization, but POM instantiation is mixed in. This works and is useful for composing complex pages from smaller vocabulary pieces.

**To document:**
- [ ] Document POM composition as an accepted pattern in architecture reference
- [ ] Clarify: `initializeElements()` may instantiate child POMs (accepted), not just locators
- [ ] Note: composed POMs receive `this.page` — they share the same Page instance

---

## A5 — Dynamic function elements in POMs

Two POMs use `(param) => Locator` function elements for dynamic DOM:
- `SearchComponent` — `quickSearchItem: (kind: string, id: string) => Locator`
- `SettingsDrawerPage` — `profileName(index: number)`, `removeProfile(index: number)`

These handle lists, grids, or indexed UI elements where the testid depends on runtime data.

**To document:**
- [ ] Document in architecture reference as an accepted element type alongside static `Locator`
- [ ] Note: function elements don't get `withDescription()` wrapping automatically — callers should use `withDescription()` in the function body if trace readability matters
- [ ] Type signature convention: `(param: type) => Locator`

---

## A6 — Fixture barrel exports are dead code

All 19 specs import from specific fixture files (e.g., `@tw-portfolio/test-e2e/fixtures/appPages`), never through the `index.ts` barrel. Named exports (`baseTest`, `appPagesTest`, etc.) exist but are unused.

**Observed pattern:**
```ts
// What specs actually do:
import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

// What the barrel offers (unused):
import { appPagesTest } from "@tw-portfolio/test-e2e/fixtures";
```

**To document:**
- [ ] Decide: remove barrel exports or migrate specs to use them
- [ ] If keeping direct imports: document as the convention and remove the barrel
- [ ] Low priority — no correctness impact

---

## A7 — Cookie mode divergence between OAuth and demo fixtures

`sessionBase.ts` parameterizes session creation by mode:
- OAuth: `cookieMode: "domain"` (cookie scoped to domain — works across subpaths)
- Demo: `cookieMode: "url"` (cookie scoped to specific URL)

This affects cookie visibility silently. A test author switching from `demoBase` to `oauthBase` (or vice versa) gets different cookie behavior with no compile-time or runtime warning.

**To document:**
- [ ] Add inline comment in `sessionBase.ts` explaining the divergence and why each mode exists
- [ ] Document in architecture reference: fixture base selection affects cookie scope
- [ ] Note for test authors: if a test works with one base but fails with another, check cookie mode first

---

## A8 — TestUser lifecycle: reset vs assignIdentity

`TestUser` has two setup methods with different side effects, neither fully documented:

| Method | API call | Clears cache? | Clears cookies? | Sets identity cookie? |
|---|---|---|---|---|
| `reset(apiBaseUrl)` | POST `/__e2e/reset` | No | No | No |
| `assignIdentity(appBaseUrl)` | None | No | **Yes (all)** | Yes (`tw_e2e_user`) |

**Gotcha:** `assignIdentity()` calls `page.context().clearCookies()` — nukes all cookies including any set during Arrange. Tests that call `assignIdentity()` after setting session cookies will lose them silently.

**Fixture base behavior:**
- `base.ts` — calls both `reset()` and `assignIdentity()` (authenticated + prewarmed)
- `noAuthBase.ts` — calls neither (blank slate)
- `sessionBase.ts` — calls neither, but mints session cookie separately

**To document:**
- [ ] Add TestUser lifecycle section to architecture reference
- [ ] Document the cookie-clearing side effect of `assignIdentity()`
- [ ] Document which fixture base calls which methods

---

## A9 — Fixture base selection decision tree

Four fixture bases exist, each with different auth/setup semantics. No decision guide for test authors choosing which base to extend.

```
base.ts            → authenticated, prewarmed, identity assigned
                     Use for: standard app feature tests (dashboard, settings, portfolio)

noAuthBase.ts      → blank slate, no auth, no prewarming
                     Use for: login flows, auth error pages, unauthenticated behavior

sessionBase("oauth") → OAuth session cookie minted, no prewarming, no identity assignment
                       Use for: OAuth-specific flows, session management tests

sessionBase("demo")  → Demo session cookie minted, no prewarming, no identity assignment
                       Use for: demo account flows, rate-limited demo tests
```

**Page fixture layers extend these bases:**
- `appPages` extends `base` → provides all app assistants (dashboard, portfolio, settings, etc.)
- `authPages` extends `noAuthBase` → provides auth assistants (login, session, authError)
- `oauthPages` extends `sessionBase("oauth")` → provides full assistant set with OAuth session
- `demoPages` extends `sessionBase("demo")` → provides demo assistant subset

**To document:**
- [ ] Add fixture base decision tree to architecture reference (section 9, after fixture chain pattern)
- [ ] Include the 4-base diagram above
- [ ] Note: choosing the wrong base is a silent failure — tests may pass but not exercise the intended auth path

---

## A10 — Route prewarming pattern

`base.ts` prewarms 5 critical routes (DASHBOARD, SETTINGS_DRAWER, PORTFOLIO, TRANSACTIONS, TICKER) during page fixture setup via `prewarmAppRoute()`. This reduces flakiness from cold Next.js routes on first navigation.

**Implementation:** `shared.ts` maintains a module-level `warmedAppRoutes` Set. Once a route is prewarmed in a worker, subsequent tests in the same worker skip it. The `_resetWarmedRoutes()` function exists but is never called by fixture teardown (intentional — prewarming is per-worker, not per-test).

**To document:**
- [ ] Document prewarming as a reliability pattern in architecture reference
- [ ] Explain that prewarming is per-worker, not per-test (module-level cache)
- [ ] Note: only `base.ts` prewarms — `noAuthBase`, `sessionBase` do not

---

## A11 — Multi-user testing via explicit session minting

API HTTP tests that need multi-user isolation create sessions explicitly, not through fixtures:

```ts
// Create user A's session
const userASession = await sessionApi.actions.createOauthSessionForClaims({
  sub: "user-a", email: "a@example.com",
});
const userACookie = await sessionApi.arrange.sessionCookieHeader(userASession);

// Use user A's cookie in subsequent API calls
const response = await feeProfilesApi.actions.listFeeProfilesForCookie(userACookie);
```

**Examples:**
- `fee-profiles-aaa.http.spec.ts:8-21` — user A vs user B isolation
- `auth-identity-source-aaa.http.spec.ts` — cookie vs header priority

**To document:**
- [ ] Document multi-user pattern in architecture reference
- [ ] Convention: fixture provides the "default" user; explicit session minting for additional users
- [ ] Endpoint methods accept optional `cookie` param for explicit user context (e.g., `listFeeProfilesForCookie()`)

---

## A12 — createTestUser factory for multi-browser tests

`createTestUser()` fixture factory creates additional `TestUser` instances with their own `Page` objects. Pages are tracked in `ownedPages` and closed automatically on teardown.

Use case: tests that need two browser contexts (e.g., user A sees real-time update from user B's action).

**To document:**
- [ ] Document in architecture reference alongside TestUser lifecycle
- [ ] Note: factory-created users get their own `page` and `request` but share the same worker
- [ ] Teardown is automatic — `ownedPages` are closed after the test

---

## A13 — Conditional assertion helpers

Environment-dependent assertions are extracted to helper functions outside test bodies, keeping test bodies linear.

**Example:** `auth-oauth-aaa.spec.ts:9-23`
```ts
async function assertSecureCookieAttribute(session, response) {
  if (sessionCookieRequiresSecure) {
    await session.assert.responseHeaderContains(response, "set-cookie", "; Secure");
    return;
  }
  await session.assert.valueNotIncludes(/* ... */);
}
```

**Pattern:** Conditional logic lives in named helper functions at module scope, never inline in test bodies. Test bodies call the helper by name — reads as a single assertion step.

**To document:**
- [ ] Document as accepted pattern: conditional assertions belong in named helpers, not in test bodies
- [ ] Helpers should use assistant Assert methods, not raw `expect()`

---

## A14 — Direct `request` fixture for transport-layer tests

Two specs intentionally use Playwright's raw `request` fixture alongside assistants for security/transport tests:

- `auth-oauth-aaa.spec.ts:176` — `request.get(apiUrl("/settings"), ...)` to test header injection
- `auth-demo-aaa.spec.ts:12-13` — `request.post(...)` in beforeEach to reset rate limit buckets

**Pattern:** Transport-layer tests that verify the HTTP layer itself (header priority, rate limiting) bypass the assistant abstraction intentionally. This is not an anti-pattern — assistants abstract behavior, but these tests verify the transport.

**To document:**
- [ ] Document as accepted exception in architecture reference (boundary rules)
- [ ] Heuristic: if the test verifies transport/header behavior, raw `request` is appropriate
- [ ] If the test verifies application behavior, use assistants

---

## A15 — Test naming convention

All 19 AAA specs use a consistent naming pattern: `"[context]: [action] → [result]"` with arrow separators for multi-step flows.

**Examples:**
- `"edit flow: change quantity → save → toast → table refresh"`
- `"delete flow: dialog → confirm → toast → table refresh"`
- `"full returnTo roundtrip through OAuth"`
- `"demo user can see seeded transactions on the symbol detail page"`

**To document:**
- [ ] Document naming convention in architecture reference
- [ ] Arrow (`→`) indicates flow sequence in multi-step tests
- [ ] Name should reveal what's being verified without reading the test body

---

## A16 — Shared/reusable POM components

`TransactionFormComponent` is used in two different contexts:
- `TransactionsPage.transactionForm` — primary transaction form
- `TickerDetailPage.recordDialog` — same form, different context (record from ticker detail)

**Pattern:** POM components that represent reusable UI widgets (modals, forms, drawers) can be composed into multiple parent POMs. The parent names the slot contextually.

**To document:**
- [ ] Document reusable POM component pattern in architecture reference (section on POMs)
- [ ] Convention: shared components live in `pages/shared/`, parent POMs give them contextual names

---

## A17 — Nested locator chaining from root

Three POMs use a scoped root locator then chain children from it:

```ts
// SideNavigationComponent
const root = this.locate("side-navigation", "Side navigation container");
this._elements = {
  root,
  dashboardLink: root.getByTestId("nav-dashboard"),
  portfolioLink: root.getByTestId("nav-portfolio"),
};
```

**Pattern:** For components that exist inside a specific container, define a `root` locator first, then chain child lookups from `root` instead of `this.page`. This scopes element resolution to the container, preventing ambiguity when multiple instances exist.

**To document:**
- [ ] Document as recommended pattern for container-scoped elements
- [ ] When to use: component appears inside a specific container (drawer, dialog, sidebar)
- [ ] When NOT to use: top-level page elements with unique testids

---

## A18 — API Assert response body typing

`BaseEndpoint` returns raw `APIResponse` by design (47% of tests assert non-2xx). Assert classes need to parse and narrow the body, but there is no shared pattern — each Assert does it ad-hoc.

**Observed approaches:**
- `statusIs(response, 200)` — checks status, no body parsing
- `fieldEquals(response, "field", value)` — parses JSON inline, checks one field
- `bodyEquals(response, expected)` — full body comparison
- Ad-hoc: `const body = await response.json(); /* then check fields */`

**To document:**
- [ ] Document the Assert response-typing convention (or lack thereof)
- [ ] Consider standardizing: `assertBody<T>(response): T` helper that asserts 2xx and returns typed body
- [ ] Note: raw `APIResponse` return is a locked decision (architecture ref section 7) — the gap is in Assert helpers, not endpoints

---

## A19 — When to create a new triplet vs extend an existing one

No guidance on whether adding a new page section means a new assistant triplet or new methods on an existing one.

**Observed approaches:**
- `TickerDetailPage` has nested POMs (deleteDialog, editForm, recordDialog) but a single triplet handles all three
- `AppShellPage` has nested POMs (topBar, sideNav, search) with a single triplet
- `Settings` and `Dashboard` are separate triplets despite being on the same page (drawer vs main content)

**Heuristic (not documented):**
- Same Playwright `Page` instance + same navigation context = same triplet
- Different navigation context or independent lifecycle = new triplet
- Sub-components (dialogs, drawers) within a page = nested POM, same triplet

**To document:**
- [ ] Document triplet scoping heuristic in architecture reference
- [ ] When to add methods to existing triplet vs create new one
- [ ] Note: SettingsDrawerPage is the upper complexity bound for a single triplet (~30 locators)

---

## A20 — Mixin diamond composition is intentional

`ArrangeMixin` and `ActionsMixin` both include `CoreMixin`. This creates a diamond:

```
        CoreMixin
       /         \
ArrangeMixin   ActionsMixin
```

TypeScript's mixin pattern resolves this correctly — `mxWaitForAppReady()` from `CoreMixin` exists once on the composed class. This is intentional and safe but undocumented.

**To document:**
- [ ] Note in architecture reference (section 3) that the diamond is intentional
- [ ] TypeScript mixin application order matters — `CoreMixin` is applied first by both, resolved by JS prototype chain
- [ ] Do not flag this as a design issue in code reviews

---

## A21 — Test data builders (helpers/fixtures.ts)

`apps/api/test/helpers/fixtures.ts` contains pure builder functions for test data:

```ts
transactionPayload()       // → valid transaction object
feeProfilePayload()        // → valid fee profile object
corporateActionDividendPayload()
corporateActionSplitPayload()
dividendEventPayload()
dividendPostingPayload()
```

These are stateless factories (no random data, no side effects). Used by both integration tests (vitest) and HTTP API specs (Playwright).

**To document:**
- [ ] Document test data builder convention in architecture reference
- [ ] Builders return minimal valid payloads — tests override specific fields as needed
- [ ] Location: `apps/api/test/helpers/fixtures.ts` (shared across vitest and Playwright)
- [ ] Note: these are NOT Playwright fixtures — naming collision with Playwright's fixture concept

---

## A22 — Playwright config conventions (retry, trace, screenshot)

`createPlaywrightConfig()` embeds several conventions that affect debugging and CI behavior:

```ts
retries: process.env.CI ? 2 : 0,       // 2 retries in CI, 0 locally
trace: "on-first-retry",                // Trace captured only on first retry
screenshot: "only-on-failure",          // Screenshot on failure
video: { mode: "retain-on-failure" },   // Video kept on failure
timeout: 30_000,                        // 30s test timeout
expectTimeout: 10_000,                  // 10s assertion timeout
```

**Implications for test authors:**
- Flaky tests get 2 chances in CI before failing — trace is available on the first retry for debugging
- Screenshots/video are NOT captured on passing tests — storage-efficient
- The 30s timeout means a stuck navigation or SSE wait will fail in 30s, not hang indefinitely

**To document:**
- [ ] Document retry/trace/screenshot strategy in architecture reference (new section after Playwright config)
- [ ] Note: local runs have 0 retries — flakiness is immediately visible
- [ ] Note: trace is only on-first-retry, not on-failure — if the retry passes, no trace is kept

---

## A23 — Separate Playwright config files per auth mode

Three separate Playwright config files exist, each calling `createPlaywrightConfig()` with different options:

| Config | Auth mode | Web servers | Test dir | Report dir |
|---|---|---|---|---|
| `apps/web/tests/e2e/playwright.config.ts` | `dev_bypass` | `full` (web+api) | `specs/` | `playwright-report` |
| `apps/web/tests/e2e/playwright.oauth.config.ts` | `oauth` | `full` (web+api) | `specs-oauth/` | `playwright-report-oauth` |
| `apps/api/test/http/playwright.config.ts` | `oauth` | `api-only` | `specs/` | `playwright-report-http` |

**Convention:** One config file per auth mode x server topology combination. Not one config with multiple projects.

**To document:**
- [ ] Document the 3-config strategy in architecture reference
- [ ] When adding a new auth mode or server topology, create a new config file
- [ ] Each config gets its own report directory to avoid overwriting

---

## A24 — Shared URL helpers (appUrl / apiUrl)

`test-framework/src/shared/url.ts` provides two URL builders used across all test layers:

```ts
appUrl("/dashboard")  // → http://localhost:3333/dashboard (from TestEnv.appBaseUrl)
apiUrl("/settings")   // → http://127.0.0.1:4000/settings (from TestEnv.apiBaseUrl)
```

**Convention:**
- `appUrl()` for web app URLs (Next.js frontend) — used in E2E navigation
- `apiUrl()` for API server URLs (Fastify backend) — used in API HTTP specs and assistants
- Both handle path joining (no double slashes)
- All endpoints use `apiUrl()`, never hardcoded base URLs

**Gotcha (documented in playwright-oauth-cookie-patterns rule):**
- `apiUrl()` resolves to `127.0.0.1` (IPv4) — fine for non-cookie API calls
- OAuth cookie operations must use `TestEnv.host` (`localhost`) for cookie domain matching

**To document:**
- [ ] Document URL helper convention in architecture reference (shared utilities section)
- [ ] Note the `apiUrl()` vs `TestEnv.host` distinction for cookie-sensitive operations

---

## A25 — E2E user identity generation

`test-framework/src/shared/userId.ts` provides stable, deterministic user identities per test:

```ts
buildE2EUserId(testInfo)
// → "qa-settings-aaa-invalid-settings-keep-drawer-open-worker0"
// Pattern: "qa-{filename}-{test-title}-worker{index}" (max 72 chars, lowercase, hyphens)

buildDisplayName(testInfo)
// → "sa:0:Alice"
// Pattern: "{acronym}:{workerIndex}:{randomFirstName}"
```

**Convention:**
- User IDs are deterministic per test (same test always gets same ID) — enables fixture reuse and debugging
- Display names are short for Playwright trace readability (used in `@Step()` labels)
- The `qa-` prefix distinguishes E2E-created users from real/seeded users

**To document:**
- [ ] Document identity generation convention in architecture reference (TestUser section)
- [ ] Note: user IDs are slug-based and deterministic — changing a test title changes its user ID
- [ ] Note: display names use acronym from test file, not full filename

---

## A26 — E2E constants registry

`test-e2e/src/constants/index.ts` centralizes all E2E magic values:

```ts
ROUTES     → { DASHBOARD, PORTFOLIO, TRANSACTIONS, LOGIN, AUTH_ERROR, SETTINGS_DRAWER }
E2E_ENDPOINTS → { RESET, OAUTH_SESSION, DEMO_SESSION, RESET_DEMO_RATE_BUCKETS }
TIMEOUTS   → { APP_READY: 30_000, SSE_HEARTBEAT: 15_000, DEFAULT: 10_000 }
TEST_DATA  → { TICKER_SYMBOL: "2330" }
```

Plus `SHARED_TEST_IDS` in `pages/constants.ts` for cross-POM testid references.

**Convention:**
- All routes, endpoints, timeouts, and test data constants live here — no hardcoded strings in assistants or specs
- Assistants and fixtures import from `@tw-portfolio/test-e2e/constants`
- API-side constants (endpoint paths) also referenced here for the E2E layer

**To document:**
- [ ] Document constants registry convention in architecture reference
- [ ] When adding a new route or endpoint, add to constants first
- [ ] Note: `SHARED_TEST_IDS` is for testids shared across multiple POMs (e.g., `globalErrorBanner`)

---

## A27 — locate() description string convention

`BasePage.locate(testId, description)` attaches human-readable labels to locators for Playwright trace readability. The label appears in HTML reports, trace viewer, and action logs.

**Observed convention:**
```ts
// Pattern: "[Container] [Component]" or "[Component] [Descriptor]"
this.locate("save-settings-button", "Save Settings Button")
this.locate("locale-select", "Settings Locale Select")
this.locate("side-navigation", "Side navigation container")

// Indexed items include position:
this.locate(`fee-profile-name-${index}`, `Fee Profile Name ${index}`)
```

**Fallback:** If `description` is omitted or Playwright version lacks `locator.describe()`, the raw locator string is used in logs (less readable).

**To document:**
- [ ] Document description string convention in architecture reference (POM section)
- [ ] Convention: noun phrases, Title Case, include container context
- [ ] Always provide descriptions for non-obvious locators — improves trace debugging significantly
