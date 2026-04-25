---
slug: aaa-pom-compliance-phase0
source: code-reviewer
created: 2026-04-25
reviewed_branch: worktree-e2e-aaa-page-object-fix
base_branch: dev
scope_doc: docs/004-notes/automation-refactor/scope-todo-202604251545-aaa-pom-compliance.md
---

# Code Review — AAA POM Compliance (Phase 0 + opportunistic Phase 1/2/3)

> Pre-PR structured review per `.claude/rules/code-review-before-pr.md`.
> Branch produces clean `eslint .` and `npm run typecheck`. Findings below are NOT
> compile/lint failures — they are correctness, scope, and consistency findings
> that should be triaged before opening the PR.

## Summary

Diff implements:

- **Phase 0**: `BasePage` rework (`Page | Locator` scope, `<TElements, TOptions>`, helpers `within / withinByCss / withinByRole / nth`); `describe()` defensive branch removed; Playwright floor bumped to `^1.53.0` (in 3 of 5+ pinning sites — see HIGH-2); new `mxHover / mxPressKey / mxAddCookies / mxClearCookie`; `mxReloadPage` parameterized; `eslint-plugin-aaa` scaffolded with rules `no-page-access`, `no-element-locator-chain`, `no-raw-action`; rules activated for `libs/test-e2e/src/assistants/**`; CI gate for "no new aaa eslint-disable" added.
- **Phase 1 (partial)**: TopBar / SideNavigation / Search / DividendPostingDrawer flattened (`el.X.elements.Y` → `el.X.Y`).
- **Phase 2 (partial)**: `unsavedChangesDialog`, `catalog.itemCheckbox(ticker)`, `tickers.repairSelection(ticker)` POM additions.
- **Phase 3 (sweeps)**: `this.page.waitForResponse` → `mxWaitForResponse`; `this.page.goto` → `mxGotoUrl`; raw `keyboard.press` / `getByRole(...).click()` → `mxPressKey` / `mxClick`.
- **Phase 3e production fix**: `apps/web/components/dividends/DividendCalendarClient.tsx` — moved `data-testid` from sibling marker `<div/>` to the `<Card>` root; companion assistant change drops `el.row(eventId).locator("..")`.

## Verdict

**Request changes.** Six items merit attention before this lands; two are blocking
process/scope concerns (HIGH-1, HIGH-2) and four are correctness/consistency
issues that should be addressed in this PR.

The end state is correct (rules at `error`, zero disables, full lint+typecheck
green) but the path to it conflated five planned PRs into one — see HIGH-1.

---

## Findings

### 🔴 HIGH

#### [ ] HIGH-1 — Five planned PRs merged into one; `0.5b` codemod step skipped

The scope-todo (`docs/004-notes/automation-refactor/scope-todo-202604251545-aaa-pom-compliance.md`) explicitly locks design decisions Q1, Q4, C1, C2:

> Q1: Full migration ("done means done"), broken into 5 sequential PRs with phased commits
> Q4: One PR per phase, 5 PRs total, sequential merging
> C1: Phase 0 commits 0.5a (plugin off) and 0.5b (activate + codemod disables) split atomically — neither commit alone breaks `eslint .`
> C2: Each Phase 1 commit (1a–1i) is an atomic bundle ... no bisect-broken intermediate states

Observed:

- `git grep -c "eslint-disable.*aaa/" libs/test-e2e/src/assistants/` returns **0**, not the ~190 the codemod step (0.5b) was supposed to insert.
- The diff covers Phase 0 + opportunistic Phase 1f/g/h (TopBar/SideNav/Search/DividendPostingDrawer flatten) + Phase 2a (`unsavedChangesDialog`, `catalog.itemCheckbox`) + Phase 3a/3b/3c/3e sweeps. That is roughly **3 of the 5 planned PRs** in one diff.
- No new POMs were added (no `AdminUsersPage`, `AdminInvitesPage`, `AdminAuditLogPage`, `AdminSettingsPage`, `ConfirmDialogComponent`, `NotificationDropdownComponent`, `TimeframeCustomizePopoverComponent`, `CardGridComponent`, `TableComponent`), so Phase 1a–1e and 1i are *not* done — meaning a fair number of `el.testId(...)` calls remain in `AppShellAssert` / `AppShellActions` that the planned admin POMs would absorb.

End state is "rules at error, zero disables, full suite green" which IS the eventual goal. But:

- Reviewability: a 1293/621-line diff across 60+ files is harder to review than 5 small PRs. The scope decision was made deliberately for that reason.
- Risk-of-regression: bisecting any post-merge regression to the originating phase is now impossible.
- Hard-freeze justification: the freeze (Q10) was scoped to ~1 week with phased landings. A single big-bang PR breaks that planning.

**Decision required from the user before this PR opens**: accept the deviation from the 5-PR plan (and update the scope-todo to reflect the actual landing strategy), or split into the originally-planned PRs. Splitting now is cheap because the diff is staged-but-uncommitted — git-add-by-hunk per phase is straightforward.

#### [x] HIGH-2 — Playwright floor bump (C3) is incomplete

Scope-todo C3 names three files; the diff updates exactly those three (`package.json`, `libs/test-framework/package.json`, `libs/test-e2e/package.json`). But the repo also pins `@playwright/test` to `^1.51.1` in:

- `apps/api/package.json` (devDeps)
- `apps/web/package.json` (devDeps)
- `libs/test-api/package.json` (deps)

Verified via `grep -B 5 '"@playwright/test": "\^1.51.1"' package-lock.json`.

Today npm dedupes everything to 1.58.2 so nothing is broken at runtime, but the floor declarations now disagree across packages. If any of those three packages is ever installed standalone (or if a future install picks an older minor matching ^1.51.1), the framework code that depends on `Locator.describe()` (Phase 0.2 dropped the defensive branch) will throw `TypeError: locator.describe is not a function`.

**Fix:** bump all five `^1.51.1` references to `^1.53.0` in the same PR. The scope-todo's C3 list is a **floor** — the rule is "every package that pins Playwright must be at least 1.53". The phrasing of C3 should be tightened in the scope-todo as part of this PR.

---

### 🟡 MEDIUM

#### [x] M-1 — `mxWaitForResponse` API is fragile (subtle await-ordering contract)

`libs/test-framework/src/mixins/ActionsMixin.ts:75-94` accepts an optional second arg that's `(() => Promise<unknown>) | { timeout?: number }` plus an optional third positional `timeout`. Two consumer patterns observed in this diff:

```ts
// Pattern A — caller triggers the action AFTER receiving the unawaited promise
const responsePromise = this.mxWaitForResponse(predicate);
await this.uiActions.click.perform(this.el.X);
return responsePromise;

// Pattern B — pass the action into the helper (interleaved)
return await this.mxWaitForResponse(predicate, () => this.uiActions.click.perform(...));
```

Pattern A only works because the body of `mxWaitForResponse` reaches `this.page.waitForResponse(predicate)` synchronously (no `await` precedes it when no `action` is passed) — Playwright sets up the listener at *call* time, so the listener is attached before control returns to the caller's `await this.uiActions.click(...)`. If anyone ever adds an `await` earlier in the function body (e.g., for logging or timeout-resolution), Pattern A becomes a race that loses the response on fast machines.

Recommendations (pick one):

1. Force the action callback (rename to `mxWaitForResponseDuring(predicate, action)`); kill Pattern A entirely. Cleaner, eliminates the implicit ordering contract.
2. If both patterns must stay, document the `pattern A` contract inline (`// CONTRACT: do not introduce an await before this.page.waitForResponse(...)`).
3. Split into two methods: `mxWaitForResponseDuring(predicate, action)` and `mxStartWaitingForResponse(predicate)` (returns a `Promise<Response>` already-listening). The two-method form makes the listener-attach timing explicit at the call site.

Not blocking — current consumers work — but this is a refactor land mine.

#### [x] M-2 — ESLint plugin is missing `meta.name` / `meta.version`

`libs/test-framework/eslint-plugin/index.js` exports only `{ rules }`. Per ESLint's flat-config plugin migration docs (verified via context7 against current ESLint maintainer docs):

> Without this meta information, your plugin will not be usable with the `--cache` and `--print-config` command line options.

**Fix:**

```js
export default {
  meta: {
    name: "@tw-portfolio/eslint-plugin-aaa",
    version: "0.1.0",
  },
  rules: { /* ... */ },
};
```

Mirror the version from `libs/test-framework/eslint-plugin/package.json`.

Cheap, prevents future cache invalidation surprises in CI.

#### [x] M-3 — `LoginActions.waitForLoginPageReady` violates the `networkidle` rule

`libs/test-e2e/src/assistants/auth/LoginActions.ts:19` —

```ts
await this.page.waitForLoadState("networkidle").catch(() => undefined);
```

`.claude/rules/playwright-navigation-patterns.md` is unambiguous: "page.waitForLoadState('networkidle') can NEVER resolve when an SSE EventSource is open. **Never use `waitForLoadState('networkidle')` in this app's E2E tests.**" Even on `/login` (no SSE yet), the `.catch(() => undefined)` is silent failure-swallowing, and it sets a precedent that future contributors will copy into spec-side helpers where SSE *is* open.

**Fix:** drop the line, or replace with the documented soft-load pattern:

```ts
await this.page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
```

The `wait.perform(this.el.googleSignInButton)` + conditional demo-button wait that precedes line 19 already covers the legitimate "is the page rendered" check. Line 19 may simply be redundant.

#### [x] M-4 — Phase 0.4 `mxAddCookies` exists but `SessionActions.plantSessionCookie` doesn't use it

`libs/test-e2e/src/assistants/auth/SessionActions.ts:52`:

```ts
await this.page.context().addCookies([cookie]);
```

`mxAddCookies(cookies: TBrowserCookie[]): Promise<void>` was added to `ActionsMixin` (line 60-63) specifically to absorb this pattern (Phase 0.4 in the scope-todo). It's not used here. The `no-page-access` rule allows `this.page.context` so lint passes — but the migration is incomplete. One of the rule's stated motivations is "all cookie operations go through mixins so we can add logging/tracing centrally."

**Fix:** `await this.mxAddCookies([cookie]);`

#### [x] M-5 — `no-raw-action` rule has coverage gaps relative to the actual remaining call surface

`RAW_ACTIONS = new Set(["click", "fill", "hover", "press"])` — but the codebase still has uncovered raw Playwright actions in assistants:

- `await source.dragTo(target);` and `await target.page().mouse.move(0, 0);` in `AppShellActions.ts` `dndKitDrag` helper (lines 24-25)
- `await this.el.topBar.avatarButton.focus();` in `AppShellActions.focusAvatarButton` (line 131)
- `await toggle.check();` / `await toggle.uncheck();` in `AppShellActions.toggleAdminSettingsOverride` (lines 218, 220)

These pass lint because none of `dragTo`, `mouse.move`, `focus`, `check`, `uncheck` are in the banned set. The scope-todo "Out of Scope" section says "`mxFocus` / `mxClear` mixin shortcuts — not required by current violations; defer until needed." But these ARE current violations — the scope-todo wrote them off without accounting for them.

Pick one of:

1. Add `mxFocus`, `mxCheck`, `mxUncheck`, `mxDragTo` to `ActionsMixin` and update the rule's `RAW_ACTIONS` set in this PR.
2. Document explicitly (in the rule's `meta.docs.description` or a sibling rule `meta.docs.url`) that these are deliberately allowed; update the scope-todo's "Out of Scope" to name them by name.

Either is fine — the current state is "implicit allow-list" which is the worst of both options.

#### [x] M-6 — New `BasePage` helpers (`within`, `withinByCss`, `withinByRole`, `nth`) have zero consumers

Phase 0.1 added these helpers; the diff has 0 calls to any of them. Meanwhile there are 42 `.locator(` chains in `libs/test-e2e/src/pages/` that fit the patterns those helpers were designed for (e.g., `this.locate("avatar-button").locator("img")` in `AppShellPage.ts:58-65` is precisely `withinByCss`).

Not blocking — the helpers are now available for Phase 1+ POMs. But "added unused" deserves either:

1. A one-shot retrofit pass in this PR (~30-40 sites, mechanical), demonstrating the helpers' value, OR
2. An explicit note in the scope-todo that retrofit is deferred and the helpers exist purely for new code.

Recommend option 1 for the smallest cluster (the 6-8 `this.locate(X).locator(Y)` chains) — proves the helpers are correct *and* matches the "done means done" scope philosophy.

---

### 🟢 LOW

#### [x] L-1 — Custom rules are missing `meta.docs.url` (ESLint best practice)

Each of `no-page-access`, `no-element-locator-chain`, `no-raw-action` declares `meta.docs.description` but not `meta.docs.url`. ESLint's official rule-authoring docs (via context7) recommend `url`. Even pointing at the in-repo scope-todo would help reviewers find the rationale fast.

```js
docs: {
  description: "...",
  url: "https://github.com/.../docs/004-notes/automation-refactor/scope-todo-202604251545-aaa-pom-compliance.md",
},
```

#### [x] L-2 — Stale rule documentation

`.claude/rules/assistant-el-getter-by-design.md` line 9 references the pre-flatten access shape `this.el.topBar.elements.avatarButton`. Phase 1 flatten (now done in this PR) removes the `.elements.` middle. The rule should be updated:

> Moving the getter to a base class ... breaking type-safe element access like `this.el.topBar.avatarButton`.

Same line 9 — small one-word delete (`elements.` → ``).

#### [x] L-3 — `apps/web/package.json` `next` bump (`16.1.6` → `^16.2.4`) is out of scope

The scope-todo names test-framework and test-e2e as the in-scope packages; production-app dependencies are not mentioned. The exact-pin-to-caret change also widens the version-resolution range in a way that's a behavior change, not just a version bump. If the bump is intentional (e.g., a security fix), it deserves its own commit + commit message + ticket reference per `.claude/rules/commit-format.md`.

If unintentional (left over from rebase / unrelated WIP), revert.

#### [x] L-4 — `aaa/no-element-locator-chain` rule has no allow-list for legitimate `Locator.locator(...)` chains in pages

The rule scope is correctly limited to `libs/test-e2e/src/assistants/**` so pages can chain freely. But within an assistant, *some* `.locator()` calls might be legitimate escape hatches — e.g., the `dndKitDrag` helper at the top of `AppShellActions.ts` is a private function, not a method, and might be exempted. Currently the rule has no schema for an allow-list (it's `schema: []`). If exemptions become necessary, the rule will need to grow a `{ allowedReceivers: string[] }` option. Worth considering up front.

Not blocking; flag for future.

---

### ⚪️ INFORMATIONAL

#### I-1 — `mxClearCookies` (plural, no-arg) added but not in scope

`libs/test-framework/src/mixins/ActionsMixin.ts:70-73` adds `mxClearCookies()` (clear ALL). Scope-todo Phase 0.4 only specifies `mxClearCookie(name)` (singular). The plural variant is now consumed by `SessionActions.clearCookies()` — fine, it was needed in practice. Just note it for the scope-todo update.

#### I-2 — CI grep gate handles the happy path; consider also failing if rules are accidentally disabled globally

`.github/workflows/ci.yml:19-26` checks for *new* `eslint-disable.*aaa/` additions in PRs. It does NOT verify the rules remain set to `error` in `eslint.config.mjs`. A future PR that flips them to `warn` (or removes the plugin block entirely) would slip through. Cheap addition: a second grep or a `node -e "..."` that loads the config and asserts `rules['aaa/no-page-access']` is `'error'`.

Not strictly required — the existing `eslint .` gate would still surface violations in the activated scope — but worth noting.

#### I-3 — `el.testId(...)` heavy usage in `AppShellAssert` / `AppShellActions` is expected Phase-0 carryover

A grep of `AppShellAssert.ts` shows ~25 occurrences of `this.el.testId("...")` (e.g., admin testids, notification testids). These are exactly the call sites that the planned Phase 1 admin POMs (`AdminUsersPage`, `AdminInvitesPage`, etc.) and `NotificationDropdownComponent` are supposed to absorb. They're not violations under the current rule set, but they're the next migration target. Code reviewer should not flag them as new debt — they are pre-existing debt that this PR explicitly defers.

---

## Out-of-scope observations (not findings — context only)

- **Production fix is correctly minimal.** `apps/web/components/dividends/DividendCalendarClient.tsx` change moves `data-testid` from a sibling-marker `<div/>` onto the `<Card>` root. Surgical, semantically equivalent for callers (the testid resolves to the same DOM subtree), and removes the DOM-up traversal in `DividendsAssert.rowContains`. Companion grep — `grep -rn "dividend-row-" apps/web/tests` returns no other consumers, so no orphan testids.
- **Lint + typecheck both green** (`npx eslint . --max-warnings=0` exit 0; `npm run typecheck` exit 0). Did not run the full 8-suite gate per `.claude/rules/full-test-suite.md` — that's the implementer's pre-merge step, not the reviewer's.
- **The `Page | Locator` widening in BasePage uses the `"context" in scope` narrowing** (`libs/test-framework/src/core/BasePage.ts:19`). This works because `BrowserContext` only exists on `Page`, not on `Locator`. The narrowing is correct but worth a 1-line comment for the next reader.

## Suggested fix order (TDD validation per `.claude/rules/code-review-before-pr.md`)

1. HIGH-2 (Playwright floor) — single-line change in 3 package.jsons; no tests needed.
2. M-3 (networkidle removal) — drop the line, run `npm run test:e2e:oauth:mem --prefix apps/web` to confirm `LoginActions.navigateToLogin` doesn't regress.
3. M-4 (`mxAddCookies` adoption) — one-line swap in `SessionActions.plantSessionCookie`, run OAuth E2E suite.
4. M-2 (plugin meta) — add `meta` block; run `eslint .`.
5. M-5 (no-raw-action coverage) — decide policy, update `RAW_ACTIONS` set or scope-todo.
6. M-6 (consume new helpers) — retrofit smallest cluster; lint + typecheck.
7. L-1, L-2, L-3, L-4 — batch edits.
8. HIGH-1 (split or accept) — user decision; if splitting, do this LAST (no point splitting if other fixes change the diff).

Then run the full 8-suite per `.claude/rules/full-test-suite.md` before opening the PR.

---

## Resolution log (2026-04-25)

All 11 non-HIGH-1 findings addressed in a single fix-up pass. Lint + typecheck both green afterward.

| ID | Resolution |
|---|---|
| HIGH-2 | Bumped `apps/api`, `apps/web`, `libs/test-api` to `^1.53.0`; ran `npm install --package-lock-only`. No more `^1.51.1` workspace pins. |
| M-1 | Added an inline CONTRACT block to `mxWaitForResponse` documenting the listener-attach ordering for Pattern 2. Kept both call patterns; the contract is now load-bearing-but-explicit. |
| M-2 | Added `meta: { name: "@tw-portfolio/eslint-plugin-aaa", version: "0.1.0" }` to `libs/test-framework/eslint-plugin/index.js`. |
| M-3 | Removed `await this.page.waitForLoadState("networkidle").catch(...)` from `LoginActions.waitForLoginPageReady`. The two preceding `wait.perform` calls cover the readiness check. |
| M-4 | `SessionActions.plantSessionCookie` now uses `await this.mxAddCookies([cookie])` instead of `this.page.context().addCookies([cookie])`. |
| M-5 | Expanded `RAW_ACTIONS` to `{check, click, dragTo, fill, focus, hover, press, uncheck}`. Added `mxFocus`, `mxCheck`, `mxUncheck`, `mxDragTo`, `mxMoveMouse` to `ActionsMixin`. Migrated 4 sites in `AppShellActions.ts`, 2 in `SettingsActions.ts`, 2 in `TransactionsActions.ts`. The `dndKitDrag` top-level helper became a private method `this.dndKitDrag` so it can call `mxDragTo` / `mxMoveMouse`. |
| M-6 | Migrated 10 single-CSS-child `this.locate(X).locator(Y)` chains to `this.withinByCss(...)` (+ 1 to `this.nth(...)`). 5 `.filter()` chains remain — out of "smallest cluster" scope. |
| L-1 | Added `meta.docs.url` (pointing at the scope-todo) to all three rules. |
| L-2 | Updated the example shape in `.claude/rules/assistant-el-getter-by-design.md` from `el.topBar.elements.avatarButton` to `el.topBar.avatarButton`. |
| L-3 | **Correction**: the `next` bump (16.1.6 → ^16.2.4) was a security fix — `npm audit` against the reverted version flagged 6 high-severity Next.js advisories (HTTP request smuggling, CSRF bypass, DoS, etc.) and a transitive postcss XSS. Re-applied the bump but normalized to exact pin `16.2.4` to match the repo's pre-existing convention. The bump should land with a commit-message note citing the security advisories. |
| L-4 | Added a code-comment in `no-element-locator-chain.js` documenting how to grow the schema to `{ allowedReceivers: string[] }` if exemptions become necessary. |

**Open**: HIGH-1 (5-PR split or accept) — requires user decision. The fix-up pass deliberately did NOT touch this; everything else is mechanical.
