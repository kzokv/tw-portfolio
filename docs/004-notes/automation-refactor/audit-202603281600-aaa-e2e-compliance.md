# AAA E2E Compliance Audit — 2026-03-28

Frozen snapshot from `/aaa:audit` run. Tracks remaining tech debt in E2E assistant classes.

## Context

- All 21 AAA-suffixed spec files (13 web E2E + 8 API HTTP) have **zero raw `expect()` calls** — fully compliant.
- Raw `expect()` in AAA specs is now **enforced by ESLint** via `no-restricted-syntax` on `CallExpression[callee.name="expect"]` scoped to `*-aaa.spec.ts` and `*-aaa.http.spec.ts` globs. This rule does not apply to non-AAA specs or assistant classes.
- Violations below are internal to assistant classes and are cosmetic/logging concerns, not correctness issues.
- 3 non-AAA spec files are legitimate (not migration leftovers — verified against Phase 5e design doc).

---

## TODO: W1 — Direct `this.page.*` bypassing framework layer

19 actionable instances across 12 assistant files. The remaining ~16 uses are legitimate (no framework equivalent for `route()`, `evaluate()`, `context()`, `once()`, `unroute()`).

### Should use mixin `mxNavigateToRoute()` or `this.uiActions`

- [ ] `libs/test-e2e/src/assistants/auth/LoginActions.ts:24` — `this.page.goto()`
- [ ] `libs/test-e2e/src/assistants/auth/LoginActions.ts:32` — `this.page.goto()`
- [ ] `libs/test-e2e/src/assistants/auth/SessionActions.ts:26` — `this.page.goto()`
- [ ] `libs/test-e2e/src/assistants/auth/SessionActions.ts:115` — `this.page.goto()`
- [ ] `libs/test-e2e/src/assistants/auth/AuthErrorActions.ts:11` — `this.page.goto()`
- [ ] `libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts:20` — `this.page.goto()`

### Should use mixin `mxWaitForResponse()`

- [ ] `libs/test-e2e/src/assistants/auth/LoginActions.ts:74` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/dashboard/DashboardActions.ts:30` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/dashboard/DashboardActions.ts:37` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts:38` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts:76` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts:107` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/settings/SettingsActions.ts:79` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/transactions/TransactionsActions.ts:38` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/transactions/TransactionsActions.ts:45` — `this.page.waitForResponse()`
- [ ] `libs/test-e2e/src/assistants/transactions/TransactionsActions.ts:52` — `this.page.waitForResponse()`

### Should use `this.uiActions` or POM elements (`this.el`)

- [ ] `libs/test-e2e/src/assistants/portfolio/PortfolioActions.ts:21` — `this.page.waitForURL()`
- [ ] `libs/test-e2e/src/assistants/settings/SettingsActions.ts:88` — `this.page.keyboard.press()`
- [ ] `libs/test-e2e/src/assistants/settings/SettingsActions.ts:93,98` — `this.page.getByRole()`

### Acceptable (no framework equivalent)

No action needed — documented for completeness:

| Pattern | Files | Reason |
|---|---|---|
| `this.page.route()` / `unroute()` | LoginActions, LoginArrange, AppShellArrange, SessionActions | Network interception — no AAA wrapper |
| `this.page.evaluate()` | AppShellAssert, LoginAssert, SessionArrange | JS execution — no AAA wrapper |
| `this.page.context().*` | SessionActions, SessionArrange | Browser context ops — no AAA wrapper |
| `this.page.once()` | DashboardActions | Event listener — no AAA wrapper |
| `this.page.waitForLoadState()` | LoginActions:19 | `networkidle` catch — intentional |

---

## TODO: W3 — Missing `get el()` typed getter

Assistants that access elements but lack the typed getter. Fixing W1 would naturally resolve most of these.

- [ ] `libs/test-e2e/src/assistants/auth/AuthErrorActions.ts`
- [ ] `libs/test-e2e/src/assistants/auth/SessionActions.ts`
- [ ] `libs/test-e2e/src/assistants/auth/AuthErrorAssert.ts` — uses `this.page.getByText()` instead of `this.el`

---

## Non-AAA Specs (legitimate, not migration leftovers)

| File | Status | Per design doc |
|---|---|---|
| `specs/sse-events.spec.ts` | Stays in E2E | Browser-mediated SSE, not HTTP-migrable |
| `specs/identity-resolution.spec.ts` | Stays in E2E | Uses `page.goto()` + `page.reload()` for cookie persistence |
| `specs-oauth/sse-auth.spec.ts` | Stays in E2E | Browser-mediated SSE, not HTTP-migrable |

These may be AAA-migrated in a future phase but are not migration leftovers from Phase 5e.

---

## Passing Checks

- No `expect()` in any Arrange class
- No `expect()` in any API Arrange/Actions class
- No `fullyParallel: true` (explicitly `false` in `createPlaywrightConfig.ts`)
- No `page.waitForTimeout()` (zero fixed sleeps)
- No shared mutable state across tests
- No cross-layer imports (test-e2e / test-api are isolated siblings)
- `@Step()` on all public assistant methods
- All 21 AAA-suffixed spec files have zero raw `expect()`
