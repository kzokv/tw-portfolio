---
slug: aaa-pom-compliance
source: scope-grill
created: 2026-04-25
tickets: []
required_reading:
  - docs/004-notes/automation-refactor/audit-202603281600-aaa-e2e-compliance.md
  - docs/004-notes/automation-refactor/scope-todo-202603281630-aaa-deep-audit-gaps.md
  - docs/004-notes/automation-refactor/scope-todo-202603281635-aaa-undocumented-patterns.md
superseded_by: null
---

# Todo: AAA Page-Object Compliance Migration

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The 2026-03-28 audit catalogues the same drift pattern this scope eliminates; this todo supersedes its W1/W3 sections after Phase 5 completes.

## Context

Fixes the structural pattern violation where ~190 sites across 22 of 45 assistant files in `libs/test-e2e/src/assistants/` reach into `this.page.*` directly (or chain `.locator()` / call raw `.click()`/`.fill()`/`.press()`/`.hover()`) instead of routing through `this.el` typed elements bag and `uiActions` / `mxX` mixin wrappers.

Estimated effort: ~6 dev-days across 5 sequential PRs. Hard freeze on E2E-touching feature work for the migration window.

## Locked design decisions (Phase 1 grill outcome)

| # | Decision |
|---|---|
| Q1 | Full migration ("done means done"), broken into 5 sequential PRs with phased commits |
| Q2 | Flat-class architecture: `BasePage<TElements, TOptions>` accepts `Page \| Locator` scope; sub-components extracted via `.elements` at parent composition site; consumer access is flat (`el.X.Y`, no `.elements.` middle) |
| Q3 | Custom `eslint-plugin-aaa` lands in Phase 0; per-violation `eslint-disable-next-line` comments at all 190 sites; later phases remove disables proportionally |
| Q4 | One PR per phase, 5 PRs total, sequential merging |
| Q5 | 5 admin POMs (`AdminShellPage`, `AdminUsersPage`, `AdminInvitesPage`, `AdminAuditLogPage`, `AdminSettingsPage`) + 4 assistant triplets; `AdminShellPage` composed only |
| Q6 | 6 new shared/layout components (Table, ConfirmDialog, RechartsContainer, CardGrid, TimeframeCustomizePopover, NotificationDropdown); folded additions for low-element groups (avatar img/initials, SEO meta, catalog item-checkbox, unsaved-changes dialog buttons); no new assistant triplets beyond admin |
| Q7 | `TableComponent` defaults to ARIA (`getByRole`); CSS opt-out via `{ mode: "css" }` constructor option (first consumer of `TOptions` channel) |
| Q8 | `ConfirmDialogComponent` takes a root `Locator` in its constructor; host POM is responsible for resolving "which dialog is open" |
| Q9 | Full 8-suite green required per PR merge (no subset, no flake-retry budget); intermediate commits typecheck+lint clean; pre-merge "no new ESLint disables" grep gate added |
| Q10 | Hard freeze on `libs/test-e2e/`- and `libs/test-framework/`-touching feature work for full migration window (~1 week) |
| Q11 | Distribute methods to host-page assistants: admin → 4 admin triplets; timeframe-customize → Dashboard + Settings; card-grid → Dashboard + Portfolio + Transactions; notification + sharing-menu + nav + search stay in AppShell. Target shape: AppShellAssert ~25 methods (from ~75), AppShellActions ~20 methods (from ~50) |
| Q12 | Two DOM-up traversal sites fixed in scope via existing/added testids (no framework helper, no allowlist exemption) |
| C1 | Phase 0 commits 0.5a (plugin off) and 0.5b (activate + codemod disables) split atomically — neither commit alone breaks `eslint .` |
| C2 | Each Phase 1 commit (`1a`–`1i`) is an atomic bundle: new POM/component + parent's `_elements` update + consumer assistant updates + spec call renames + `eslint-disable` removal. No bisect-broken intermediate states |
| C3 | Phase 0 commit `0.2` bumps `@playwright/test` floor from `^1.51.1` to `^1.53.0` in `package.json`, `libs/test-framework/package.json`, `libs/test-e2e/package.json` |

## Implementation Steps

### PR 1 — Phase 0: framework foundation + ESLint rule

- [ ] **0.1** `BasePage` rework
  - Accept `Page | Locator` scope; widen with `<TElements, TOptions = Record<string, never>>` type parameters
  - Set `this.page` from `scope.page()` when scope is a Locator, from `scope` directly when it's a Page (detect via `"context" in scope`)
  - Use `this.scope.getByTestId(...)` / `getByRole(...)` in `locate()` / `locateByRole()` (instead of `this.page.*`)
  - Add scope helpers: `within(parent, testId, description?)`, `withinByCss(parent, css, description?)`, `withinByRole(parent, role, options?)`, `nth(parent, css, index, description?)`
- [ ] **0.2** Cleanup + Playwright floor bump
  - Remove the `if (typeof describedLocator.describe === "function")` defensive branch in `BasePage.withDescription()` — `describe()` is now guaranteed
  - Bump `@playwright/test` floor from `^1.51.1` to `^1.53.0` in `package.json`, `libs/test-framework/package.json`, `libs/test-e2e/package.json`
- [ ] **0.3** Extend `TUIActions` interface
  - Add `hover` (`THoverAction`) and `keyboardPress` (`TKeyboardPressAction`) to `TUIActions`
  - Implement `NormalHover` and `NormalKeyboardPress` in `libs/test-framework/src/actions/`
  - Wire into `createUIActions()` and `defaultUIActions` singleton
- [ ] **0.4** Add `ActionsMixin` shortcuts
  - `mxHover(locator)` — delegates to `uiActions.hover.perform`
  - `mxPressKey(key)` — delegates to `uiActions.keyboardPress.perform`
  - `mxAddCookies(cookies)` — pass-through to `page.context().addCookies(cookies)`
  - `mxClearCookie(name)` — `page.context().clearCookies({ name })`
  - Parameterize existing `mxReloadPage({ waitForReady?: boolean })` — when `false`, skip the post-reload `mxWaitForAppReady()`
- [ ] **0.5a** ESLint plugin scaffolding (no enforcement yet)
  - Create `libs/test-framework/eslint-plugin/` with package.json + index.js + rule files
  - Define rules `aaa/no-page-access`, `aaa/no-element-locator-chain`, `aaa/no-raw-action`
  - Register in `eslint.config.mjs` with `severity: 'off'` (or empty `files: []` glob)
  - Rule selectors permanently exclude `page.evaluate`, `page.route`, `page.unroute`, `page.once`
  - Verify `eslint .` passes with no behavior change
- [ ] **0.5b** Activate rules + codemod disables (atomic)
  - Flip rule severity to `error` for `libs/test-e2e/src/assistants/**` glob
  - Run codemod (recommended: `ast-grep`) to insert `// eslint-disable-next-line aaa/<rule>` at each of the 190 violation sites
  - Verify `eslint .` passes (rule active, all current violations annotated)
  - Verify `git grep -c "eslint-disable.*aaa/" libs/test-e2e/src/assistants/` returns the expected count
- [ ] **0.6** Pre-merge "no new ESLint disables" CI gate
  - Add a CI step that fails if `git diff origin/dev...HEAD` adds any new `eslint-disable.*aaa/` comments (subtraction is fine)
  - Guards against regressions during phases 1–3

### PR 2 — Phase 1: POMs + components + flatten

Each commit `1a`–`1i` is an atomic bundle (POM + parent `_elements` update + consumer/spec renames + disable removal).

- [ ] **1a** `AdminUsersPage` + `AdminUsers{Arrange,Actions,Assert}` triplet + fixture
  - Compose `TableComponent` (users-table) and folded `AdminShellPage` chrome
  - Migrate ~6 methods from `AppShell{Actions,Assert}`; rename spec calls; fix DOM-up traversal (use `userRow(currentUserId)` instead of `youBadge.locator("xpath=ancestor::tr")`)
  - Remove corresponding `eslint-disable` comments
- [ ] **1b** `AdminInvitesPage` + triplet + fixture (same pattern; ~10 methods)
- [ ] **1c** `AdminAuditLogPage` + triplet + fixture (~5 methods)
- [ ] **1d** `AdminSettingsPage` + triplet + fixture
  - KZO-142 quote-poll-config section + KZO-159 timeframe-defaults section (~30 elements total)
  - Largest admin POM
- [ ] **1e** `ConfirmDialogComponent` at `libs/test-e2e/src/pages/shared/`
  - Constructor takes root `Locator`; host resolves "which dialog is open"
  - Integrate into `SharingPage` (revoke + public-link revoke), `AdminUsersPage` (hard-purge), `AppShellPage` if needed
  - Migrate ~3 inline `[data-testid="confirm-dialog"][open]` sites
- [ ] **1f** `NotificationDropdownComponent` + TopBar flatten
  - Add at `libs/test-e2e/src/pages/layout/`
  - Compose into `TopBarComponent`
  - Flatten `TopBarComponent` consumers — `el.topBar.elements.X` → `el.topBar.X` across all assistants (~30 sites)
  - Migrate ~10 notification methods from AppShell to use `el.topBar.notificationDropdown.*`
- [ ] **1g** `TimeframeCustomizePopoverComponent` at `libs/test-e2e/src/pages/shared/`
  - Compose into `DashboardPage` (PortfolioTrendCard host) and `SettingsDrawerPage` (Display tab host)
  - Migrate ~15 timeframe-customize methods from AppShell to `Dashboard{Actions,Assert}` and `Settings{Actions,Assert}`
- [ ] **1h** `CardGridComponent` at `libs/test-e2e/src/pages/shared/`
  - Compose into `DashboardPage`, `PortfolioPage`, `TransactionsPage`
  - Migrate ~12 card-reorder methods from AppShell to `Dashboard{Actions,Assert}`, `Portfolio{Actions,Assert}`, `Transactions{Actions,Assert}` (3 thin pass-through methods per host)
- [ ] **1i** `TableComponent` at `libs/test-e2e/src/pages/shared/`
  - Constructor `{ mode?: "aria" | "css" }` — defaults to `"aria"`; first consumer of `BasePage` `TOptions` channel
  - Compose into `DashboardPage` (holdings-table), `CashLedgerPage`, `DividendReviewPage`
  - Migrate ~30 row/cell/header chains across `Dashboard{Assert,Actions}`, `CashLedger{Assert,Actions}`, `DividendReview{Assert,Actions}`
- [ ] **1j** Flatten remaining legacy sub-components
  - `SearchComponent`: `_elements.search` → flat; ~12 consumer site updates
  - `SideNavigationComponent`: `_elements.sideNavigation` → flat; ~5 consumer site updates
  - Any other remaining `el.X.elements.Y` chains that weren't part of a 1a–1i bundle

After Phase 1, every assistant access path is `el.X.Y`. No `.elements.` middle anywhere.

### PR 3 — Phase 2: POM extensions

- [ ] **2a** `SettingsDrawerPage` extensions
  - Add `unsavedChangesDialog.{cancel, keepEditing}` via `locateByRole({ name: /Cancel|取消/, description: ... })`
  - Add `catalog.itemCheckbox(ticker)` function element (replaces `el.catalog.item(ticker).locator("input[type=checkbox]")`)
  - Add `general.escapePress` helper or use `mxPressKey` directly in assistant
- [ ] **2b** `SharingPage` extensions
  - `firstPublicLinkRow`, `publicLinkRows.copyButton(idx)`, `publicLinkRows.newBadge(idx)` — replaces `[data-testid^="sharing-public-link-row-"].first()` chains
- [ ] **2c** `AnonymousSharePage` extensions
  - SEO meta + body element folded inline (per Q6 fold rule)
- [ ] **2d** Table-bearing pages — adopt `TableComponent` where 1i didn't
  - Verify `CashLedgerPage`, `DividendReviewPage`, `DashboardPage` all consume `TableComponent` consistently
- [ ] **2e** `SearchComponent` extensions
  - Add `desktopQuickSearchRoute(route)` and `mobileQuickSearchRoute(route)` function elements (panel-scoped) — replaces inline `container.getByTestId(...)` in AppShellActions

### PR 4 — Phase 3: mechanical sweeps

- [ ] **3a** Sweep `this.page.waitForResponse(...)` → `await this.mxWaitForResponse(...)` (~21 sites)
  - Affects: TransactionsActions (5), TickerDetailActions (4), DashboardActions (3), DividendsActions (3), SettingsActions (3), LoginActions (1), DividendReviewActions (1), PortfolioActions (1)
- [ ] **3b** Sweep `this.page.goto(...)` / `reload(...)` → `mxGotoUrl` / `mxNavigateToRoute` / `mxReloadPage` (~9 sites)
- [ ] **3c** Sweep raw `.click/.fill/.press/.hover` → `uiActions` wrappers / `mxX` shortcuts (~9 sites)
  - Exercises new `mxHover`, `mxPressKey` from Phase 0
- [ ] **3d** Sweep `this.page.context().addCookies/clearCookies` → `mxAddCookies` / `mxClearCookie` (~4 sites)
- [ ] **3e** Fix DividendsAssert DOM-up traversal site
  - Investigate `el.row(eventId).locator("..")`; either point row testid at the actual `<tr>` or add `data-testid="dividend-row-${eventId}"` to the UI
  - Companion to the 1a fix (AppShell youBadge), completes the zero-DOM-up-traversal goal

### PR 5 — Phase 4: verification + cleanup

- [ ] **4a** Verify zero `eslint-disable.*aaa/` comments remain
  - `git grep -E "eslint-disable.*aaa/" libs/test-e2e/src/assistants/ | wc -l` returns 0
- [ ] **4b** Remove the no-new-disables CI grep gate (no longer needed; rule is unconditional)
- [ ] **4c** Append supersession note to `docs/004-notes/automation-refactor/audit-202603281600-aaa-e2e-compliance.md`
  - Header note: "**Superseded** by `scope-todo-202604251545-aaa-pom-compliance.md` — W1/W3 sections fully resolved by that effort."
  - Optionally update the W1/W3 checkboxes to reflect resolution
- [ ] **4d** Final supersession marker on this todo
  - After PR 5 merges, add `superseded_by: null` → leave (it's the final state for this scope; no successor)
- [ ] **4e** Run full 8-suite once more on `dev` post-merge as a sanity check

## Coordination

- [ ] Announce hard freeze on E2E-touching feature work to team / self before PR 1 opens
- [ ] PR 1–5 merge sequentially; do not branch parallel work from any of them
- [ ] Each PR: full 8-suite green required pre-merge (`npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`)
- [ ] Migration PRs get merge priority over conflicting feature PRs (compounding rebase cost asymmetry)

## Out of Scope

- `libs/test-api/src/assistants/**` — currently clean; ESLint rule scope deferred until needed
- Migration of class-form sub-components to function-factory pattern — explicitly rejected (Q2)
- Adding `mxFocus` / `mxClear` mixin shortcuts — not required by current violations; defer until needed
- New assistant triplets for shared components (`TimeframeAssistant`, `CardGridAssistant`) — explicitly rejected (Q6)
- UI-side test-id additions beyond the two DOM-up traversal fixes (Q12)
- Promoting `BasePage.openDialog(testId)` helper — speculative; defer until 3+ ConfirmDialog hosts demand it (Q8)
- Unit tests for the new `TUIActions` / `ActionsMixin` methods — Phase 1 exercise validates them; standalone tests deferred

## References

- **Predecessor audit:** `docs/004-notes/automation-refactor/audit-202603281600-aaa-e2e-compliance.md` (W1/W3 sections superseded by this scope)
- **Companion audit:** `docs/004-notes/automation-refactor/scope-todo-202603281630-aaa-deep-audit-gaps.md` (separate scope; not addressed here)
- **Pattern docs:** `docs/004-notes/automation-refactor/scope-todo-202603281635-aaa-undocumented-patterns.md` (A4, A5, A17 patterns relevant to this scope)
- **Worktree branch:** `worktree-e2e-aaa-page-object-fix` (based on `dev` @ 5fbd45b)
- **Relevant rules:**
  - `.claude/rules/full-test-suite.md` — defines the 8-suite gate
  - `.claude/rules/code-review-before-pr.md` — pre-PR review process
  - `.claude/rules/assistant-el-getter-by-design.md` — preserved (`get el()` per assistant)
  - `.claude/rules/e2e-aaa-guardrails.md` — preserved
