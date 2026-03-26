# Automation AAA Framework — Design Document

**Date:** 2026-03-26
**Status:** Frozen snapshot — do not update after merge
**Origin:** Grill session on `automation-refactor` worktree
**Reference repo:** https://github.com/kzokv/automation-aaa

---

## Goals

- Use Playwright framework with AAA (Arrange-Act-Assert) pattern
- Tests isolated, parallel with 2 workers (hardware constraint)
- E2E timeout strictly 30 seconds
- Integrate with API (app.inject) and UI; unit tests optional
- POM structure for UI with separation from AAA (AAA doesn't define locators)
- `@Step` decorator for Playwright step injection
- Human-readable report traces (element names, not raw selectors)
- Playwright fixtures + `mergeTests` for composition
- Class-based wrappers over exported functions
- TypeScript strict (TS 5.9 recommended set) with defined export paths
- All existing test validations preserved after refactor
- POC: `settings.spec.ts` — run old + new side-by-side to verify
- Post-POC: promote to guidance skill + hard rules

---

## Architecture Decisions

### Scope
- **Layers:** E2E (Playwright) + Integration (API via app.inject) + Unit (optional)
- **POC spec:** `settings.spec.ts`
- **Isolation model:** Existing per-test `e2eUserId` + `/__e2e/reset` stays intact
- **Migration:** Keep `helpers/flows.ts` during migration, retire after

### Lib Structure

```
libs/
├── test-framework/               @tw-portfolio/test-framework (REUSABLE)
│   ├── package.json              exports: ., ./core, ./actions, ./decorators, ./mixins, ./config
│   ├── tsconfig.json             TS 5.9 strict (extends base + strict additions)
│   └── src/
│       ├── core/
│       │   ├── TestUser.ts       Core controller (identity, cache, assistant factories)
│       │   ├── BasePage.ts       Base POM (locate() with describe(), initializeElements)
│       │   ├── TestAAA.ts        Non-generic base AAA class
│       │   └── types.ts          TTestAAAOptions, Constructor, TUIActions
│       ├── actions/
│       │   ├── fill.ts           NormalFill with logging + masking
│       │   ├── click.ts          NormalClick with logging
│       │   ├── select.ts         NormalSelect with logging
│       │   ├── wait.ts           WaitForVisible with logging
│       │   └── index.ts          createUIActions() + defaultUIActions singleton
│       ├── decorators/
│       │   └── Step.ts           Dual-context: test.step() or logger fallback
│       ├── mixins/
│       │   ├── CoreMixin.ts      Foundation: mxWaitForAppReady (shared by all AAA)
│       │   ├── ArrangeMixin.ts   Extends Core: mxSeedData
│       │   ├── ActionsMixin.ts   Extends Core: mxNavigateToRoute, mxReloadPage, mxWaitForResponse
│       │   ├── AssertMixin.ts    Extends Core: mxAssertUrlMatches, mxAssertNoGlobalError
│       │   └── index.ts          Pre-composed: BaseArrange, BaseActions, BaseAssert
│       └── config/
│           ├── assistantFactory.ts  createAssistantFactory() generic builder
│           └── mapper.ts            POM class → assistant factory registry
│
├── test-e2e/                     @tw-portfolio/test-e2e (APP-SPECIFIC)
│   ├── package.json              exports: ./pages, ./assistants, ./fixtures, ./config
│   ├── tsconfig.json
│   └── src/
│       ├── pages/
│       │   ├── layout/
│       │   │   ├── AppShellPage.ts         Composes TopBarComponent + SideNavigationComponent
│       │   │   ├── TopBarComponent.ts
│       │   │   └── SideNavigationComponent.ts
│       │   ├── settings/
│       │   │   └── SettingsDrawerPage.ts   Elements grouped by tab (general, fees, footer)
│       │   ├── dashboard/
│       │   │   └── DashboardPage.ts
│       │   └── portfolio/
│       │       └── PortfolioPage.ts
│       ├── assistants/
│       │   ├── layout/
│       │   │   ├── AppShellArrange.ts
│       │   │   ├── AppShellActions.ts
│       │   │   ├── AppShellAssert.ts
│       │   │   └── index.ts               Facade factory + type export
│       │   └── settings/
│       │       ├── SettingsArrange.ts
│       │       ├── SettingsActions.ts
│       │       ├── SettingsAssert.ts
│       │       └── index.ts
│       ├── fixtures/
│       │   ├── base.ts                    testUser + createTestUser factory
│       │   ├── appShell.ts                Extends base → provides appShell assistant
│       │   ├── settings.ts                Extends appShell → provides settings assistant
│       │   ├── oauth.ts                   Independent OAuth session (per-test, parallel)
│       │   └── merged.ts                  mergeTests compositions
│       └── config/
│           └── mapper.ts                  Register AppShellPage, SettingsDrawerPage
│
├── test-api/                     @tw-portfolio/test-api (APP-SPECIFIC)
│   ├── package.json              exports: ./services, ./assistants, ./builders
│   ├── tsconfig.json
│   └── src/
│       ├── services/             API service clients (app.inject wrappers)
│       ├── assistants/           API AAA triplets
│       └── builders/             Fluent payload builders (TransactionBuilder, etc.)

apps/web/tests/e2e/
├── playwright.config.ts          testDir: specs/
├── playwright.oauth.config.ts    testDir: specs-oauth/
├── specs/
│   ├── settings.spec.ts          OLD — kept during POC
│   └── settings-aaa.spec.ts      NEW — POC refactored spec
├── specs-oauth/
└── helpers/
    ├── flows.ts                  KEPT during migration, retired after
    └── mock-oauth-server.mjs
```

### Class Hierarchy (Simplified v2)

```
TestAAA (non-generic)
├── _instance: BasePage<unknown>
├── page: Page
└── uiActions: TUIActions (defaults to singleton)

CoreMixin(TestAAA)
└── mxWaitForAppReady()

ArrangeMixin(TestAAA) ← includes CoreMixin
├── mxWaitForAppReady()     (from Core)
└── mxSeedData()

ActionsMixin(TestAAA) ← includes CoreMixin
├── mxWaitForAppReady()     (from Core — type-safe cross-mixin call)
├── mxNavigateToRoute()
├── mxReloadPage()
└── mxWaitForResponse()

AssertMixin(TestAAA) ← includes CoreMixin
├── mxWaitForAppReady()     (from Core)
├── mxAssertUrlMatches()
├── mxAssertUrlNotMatches()
└── mxAssertNoGlobalError()

Pre-composed exports:
  BaseArrange = ArrangeMixin(TestAAA)
  BaseActions = ActionsMixin(TestAAA)
  BaseAssert  = AssertMixin(TestAAA)

createAssistantFactory({ Arrange, Actions, Assert })
  → (options) => { arrange, actions, assert }
  → type inferred via ReturnType<>
```

### Consumer Pattern (per page)

```ts
// ── AAA class (2 lines ceremony) ──
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";
import { Step } from "@tw-portfolio/test-framework/decorators";
import type { SettingsDrawerPage } from "@tw-portfolio/test-e2e/pages";

export class SettingsArrange extends BaseArrange {
  private get el() { return (this._instance as SettingsDrawerPage).elements; }

  @Step()
  async openFeesTab() {
    await this.uiActions.click.perform(this.el.tabs.fees);
  }
}

// ── Facade (2 lines) ──
import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
export const settingsAssistantFactory = createAssistantFactory({
  Arrange: SettingsArrange, Actions: SettingsActions, Assert: SettingsAssert,
});
export type TSettingsAssistant = ReturnType<typeof settingsAssistantFactory>;
```

### POM Structure

POMs follow `apps/web/components/` hierarchy. Layout composed, features independent.

```ts
class SettingsDrawerPage extends BasePage<TSettingsDrawerElements> {
  protected initializeElements(): void {
    this.elements = {
      drawer: this.locate("settings-drawer", "Settings Drawer"),
      tabs: {
        profile: this.locate("settings-tab-profile", "Profile Tab"),
        general: this.locate("settings-tab-general", "General Tab"),
        fees: this.locate("settings-tab-fees", "Fees Tab"),
      },
      general: {
        localeSelect: this.locate("settings-locale-select", "Locale Select"),
        costBasisSelect: this.locate("settings-cost-basis-select", "Cost Basis Method"),
        quotePollInput: this.locate("settings-quote-poll-input", "Quote Poll Interval"),
      },
      fees: {
        addProfileButton: this.locate("settings-add-profile-button", "Add Fee Profile"),
        profileCards: this.page.locator('[data-testid^="settings-profile-name-"]')
          .describe("Fee Profile Name Fields"),
        profileName: (index: number) =>
          this.locate(`settings-profile-name-${index}`, `Fee Profile Name [${index}]`),
        removeProfile: (index: number) =>
          this.locate(`settings-remove-profile-${index}`, `Remove Profile [${index}]`),
      },
      footer: {
        saveButton: this.locate("settings-save-button", "Save Settings"),
        discardButton: this.locate("settings-discard-button", "Discard Changes"),
        validationError: this.locate("settings-validation-error", "Validation Error"),
        closeWarning: this.locate("settings-close-warning", "Unsaved Changes Warning"),
      },
    };
  }
}
```

Element naming uses Playwright's native `locator.describe()` (v1.53+). Human-readable names appear in traces, HTML reports, and error messages.

### TestUser

Core controller class. Fresh per test via Playwright fixture.

```ts
class TestUser {
  readonly userId: string;
  readonly page?: Page;
  readonly request: APIRequestContext;
  readonly role?: string;
  private readonly notes = new Map<string, unknown>();

  async reset(apiBaseUrl: string): Promise<void>;
  async assignIdentity(appBaseUrl: string): Promise<void>;
  async useWebAssistant<TPage, TAAA>(PageClass: Constructor<TPage>): Promise<TAAA>;
  async useAppInjectAssistant<TService, TAAA>(ServiceClass: Constructor<TService>, app: unknown): Promise<TAAA>;
  appendNote<T>(key: string, values: T[]): void;
  getNote<T>(key: string): T | undefined;
}
```

Multi-user: `testUser` fixture (default, gets built-in page) + `createTestUser` factory (additional users, optional browser). Same identity pattern, fresh state.

### Fixtures

Chain `.extend()` for dependent fixtures. `mergeTests` for orthogonal concerns.

```ts
// base.ts — testUser + createTestUser
// appShell.ts — extends base → appShell assistant
// settings.ts — extends appShell → settings assistant
// oauth.ts — independent OAuth session (per-test, parallel-safe)
// merged.ts — mergeTests(settingsTest, oauthTest) for OAuth specs needing settings
```

OAuth tests parallel via per-test session (`/__e2e/oauth-session`), matching dev-bypass isolation model.

### TypeScript Config

New test libs extend `tsconfig.base.json` + add TS 5.9 strict options:
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true`
- `moduleDetection: "force"`

Existing `tsconfig.base.json` untouched (no blast radius).

Export paths via `package.json` `exports` field (conditional exports with types + default).

### @Step Decorator

Dual-context: `test.step()` with `box: true` in test context, console logger fallback in global-setup/utility context. Applied to all AAA class methods.

### uiActions

Custom action layer (fill, click, select, wait) with:
- Human-readable logging via `locator.description()`
- Sensitive data masking
- Error handling wrappers
- Optional injection, defaults to singleton

### Integration Tests (API)

- Service client classes wrapping `app.inject()` (like POMs for API)
- `TestUser.useAppInjectAssistant()` factory method
- Fluent builder classes for payloads (TransactionBuilder, FeeProfileBuilder)
- AAA triplets per API domain

---

## POC: settings.spec.ts Refactored

```ts
import { test } from "@tw-portfolio/test-e2e/fixtures/settings";

test("settings persist across routes and reloads for the same seeded user", async ({
  appShell, settings,
}) => {
  // Arrange
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();

  // Act
  const currentQuotePoll = await settings.actions.getQuotePollValue();
  const nextQuotePoll = currentQuotePoll === "12" ? "10" : "12";
  await settings.actions.changeLocale("zh-TW");
  await settings.actions.changeQuotePollInterval(nextQuotePoll);
  await settings.actions.save();

  // Assert — drawer closed, locale applied
  await settings.assert.drawerIsClosed();
  await appShell.assert.topBarTitleContains("持倉");

  // Act — navigate to dashboard
  await appShell.actions.navigateViaSidebar("dashboard");

  // Assert — settings persisted across route
  await appShell.assert.isOnRoute("/dashboard");
  await appShell.assert.topBarTitleContains("儀表板");
  await appShell.assert.quotePollValueContains(`${nextQuotePoll} 秒`);

  // Act — reload
  await appShell.actions.reloadPage();

  // Assert — settings persisted across reload
  await appShell.assert.topBarTitleContains("儀表板");
  await appShell.assert.quotePollValueContains(`${nextQuotePoll} 秒`);
});

test("invalid settings keep the drawer open and surface validation", async ({
  appShell, settings,
}) => {
  // Arrange
  await appShell.actions.navigateToRoute("/transactions");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openFeesTab();

  // Act
  await settings.actions.addFeeProfile();
  const profileCount = await settings.actions.getProfileCount();
  await settings.actions.setProfileName(profileCount - 1, "");
  await settings.actions.save();

  // Assert
  await appShell.assert.isOnRoute("drawer=settings");
  await settings.assert.validationErrorIsVisible();
  await settings.assert.drawerIsVisible();
});
```

### Assertion Coverage (old → new, 1:1)

| Old assertion | New method |
|---|---|
| `expect(page).not.toHaveURL(/drawer=settings/)` | `settings.assert.drawerIsClosed()` |
| `expect(topbar-title).toContainText("持倉")` | `appShell.assert.topBarTitleContains("持倉")` |
| `expect(page).toHaveURL(/\/dashboard/)` | `appShell.assert.isOnRoute("/dashboard")` |
| `expect(topbar-title).toContainText("儀表板")` | `appShell.assert.topBarTitleContains("儀表板")` |
| `expect(quote-poll-value).toContainText(...)` | `appShell.assert.quotePollValueContains(...)` |
| `expect(page).toHaveURL(/drawer=settings/)` | `appShell.assert.isOnRoute("drawer=settings")` |
| `expect(settings-validation-error).toBeVisible()` | `settings.assert.validationErrorIsVisible()` |
| `expect(settings-drawer).toBeVisible()` | `settings.assert.drawerIsVisible()` |

---

## Implementation Plan

### Phase 1: Foundation — `libs/test-framework/`
1. Package scaffolding (package.json, tsconfig with TS 5.9 strict, exports)
2. `core/types.ts` — TTestAAAOptions, Constructor, TUIActions
3. `core/BasePage.ts` — locate(), locateByRole(), initializeElements()
4. `core/TestAAA.ts` — non-generic, _instance, page, uiActions
5. `core/TestUser.ts` — identity, cache, useWebAssistant(), useAppInjectAssistant()
6. `decorators/Step.ts` — dual-context decorator
7. `actions/` — fill, click, select, wait with logging + defaultUIActions singleton
8. `mixins/` — CoreMixin, ArrangeMixin, ActionsMixin, AssertMixin + pre-composed exports
9. `config/` — createAssistantFactory(), mapper registry class

### Phase 2: App-specific E2E — `libs/test-e2e/`
1. Package scaffolding
2. `pages/layout/` — AppShellPage (composes TopBarComponent, SideNavigationComponent)
3. `pages/settings/SettingsDrawerPage.ts` — full element tree with describe() names
4. `assistants/layout/` — AppShell AAA triplet + facade
5. `assistants/settings/` — Settings AAA triplet + facade
6. `config/mapper.ts` — register AppShellPage + SettingsDrawerPage
7. `fixtures/base.ts` — testUser + createTestUser
8. `fixtures/appShell.ts` — extends base
9. `fixtures/settings.ts` — extends appShell

### Phase 3: POC validation
1. Write `settings-aaa.spec.ts` alongside original
2. Run both: `npx playwright test specs/settings.spec.ts specs/settings-aaa.spec.ts`
3. Compare HTML reports — verify all 8 assertions pass identically
4. Verify @Step names appear in report (human-readable, not raw selectors)

### Phase 4: Iterate
1. Tune uiActions logging format
2. Tune @Step descriptions
3. Add missing mixin methods discovered during POC
4. Run full E2E suite to verify no regressions

### Phase 5: Post-POC (separate effort)
1. Migrate remaining 15 E2E specs one at a time
2. Add DashboardPage, PortfolioPage POMs + assistants as needed
3. OAuth parallel fixture
4. `libs/test-api/` — API service clients + builders + API AAA triplets
5. Retire `helpers/flows.ts`
6. Promote guidance skill (`automation-aaa`) + hard rules (`aaa-test-structure`)

---

## Post-POC: Skill & Rule Promotion

| Artifact | Type | Scope | Timing |
|---|---|---|---|
| `automation-aaa` guidance skill | Skill | User-level (cross-project) | After POC |
| `aaa-test-structure` | Hard rule | Project-level | After POC |
| `test-framework-typescript-strict` | Hard rule | Project-level | After POC |
