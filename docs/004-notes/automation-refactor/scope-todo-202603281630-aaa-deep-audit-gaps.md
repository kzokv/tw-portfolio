# AAA Deep Audit Gaps — 2026-03-28

Frozen snapshot from deep `/aaa:audit` analysis. Covers correctness risks, undocumented patterns, security gaps, and reliability concerns discovered in test-framework internals, fixture chains, POM/endpoint classes, and spec usage patterns.

Companion to:
- `audit-202603281600-aaa-e2e-compliance.md` — surface-level compliance
- `scope-todo-202603281635-aaa-undocumented-patterns.md` — undocumented patterns to document (A1-A8)

---

## Critical: Hidden Correctness Risks

### C1 — TestUser.assistantCache survives reset()

**File:** `libs/test-framework/src/core/TestUser.ts`

`TestUser.reset()` calls the API reset endpoint but never clears:
- `assistantCache` Map (stale PageClass/EndpointClass instances survive)
- `notes` Map (append-only, never cleared)
- `_sessionCookie` (old cookie persists)

If a test calls `reset()` mid-test then re-requests an assistant via `useWebAssistant()`, it gets the stale cached instance.

- [ ] Clear `assistantCache`, `notes`, and `_sessionCookie` in `reset()`
- [ ] Add unit test: reset() → useWebAssistant() returns fresh instance

---

### C2 — CoreMixin.mxWaitForAppReady() silently swallows load failures

**File:** `libs/test-framework/src/mixins/CoreMixin.ts:16`

The "load" state wait has a 5-second hardcoded timeout with `.catch(() => undefined)`. If the page never fully loads, the test continues on a half-loaded page with no warning. False greens.

Additionally, the `timeoutMs` parameter on the method signature is ignored — the timeout is always `LOAD_STATE_TIMEOUT_MS`.

- [ ] Log a warning (not throw) when the load-state catch fires
- [ ] Respect the `timeoutMs` parameter or remove it from the signature
- [ ] Document in architecture reference: this is a soft-wait by design, not a hard gate

---

### C3 — assignIdentity() nukes all cookies

**File:** `libs/test-framework/src/core/TestUser.ts`

`assignIdentity()` calls `page.context().clearCookies()` before setting the identity cookie. If Arrange set any cookies (OAuth session, feature flags), they are silently wiped.

- [ ] Document this side effect in the architecture reference (section on TestUser lifecycle)
- [ ] Consider narrowing to clear only the `tw_e2e_user` cookie, or document why blanket clear is required

---

### C4 — Global assistant registries have no test isolation

**File:** `libs/test-framework/src/config/mapper.ts`

Three module-level singleton Maps (`webAssistantRegistry`, `appInjectAssistantRegistry`, `apiAssistantRegistry`). No `clear()` or `unregister()` method. Registrations leak across all tests in the same worker. Duplicate registration silently overwrites.

- [ ] Evaluate whether this causes real test pollution (may be benign if registrations are idempotent)
- [ ] If needed: add `_resetRegistries()` for test isolation, or document why global registration is safe

---

### C5 — warmedAppRoutes cache never resets

**File:** `libs/test-e2e/src/fixtures/shared.ts:21`

Module-level `Set<string>` tracks prewarmed routes. `_resetWarmedRoutes()` exists but is never called by any fixture teardown. Tests after the first may skip prewarming, getting different timing behavior.

- [ ] Call `_resetWarmedRoutes()` in base fixture teardown, or document that shared prewarming is intentional per-worker

---

## Security / Logging Gaps

### S1 — Sensitive fill masking is incomplete

**File:** `libs/test-framework/src/actions/fill.ts:14`, `libs/test-framework/src/logging/ActionLogger.ts`

`fill.ts` masks the value in console output (`SENSITIVE_MASK`), but `ActionLogger.writeJsonl()` receives the full action label string containing the unmasked value. JSONL logs in CI artifacts could expose test secrets.

- [ ] Mask the value in the JSONL entry as well, or pass `sensitive` flag through to ActionLogger
- [ ] Audit CI artifact retention policy for JSONL logs

---

### S2 — authHeaders silently discards userId when sessionCookie exists

**File:** `libs/test-framework/src/core/ApiAAABase.ts:6-14`

If `testUser` has both `sessionCookie` and `userId`, only the cookie header is returned. The `x-user-id` header is dropped with no documentation of priority.

- [ ] Add JSDoc to `authHeaders` getter documenting priority: sessionCookie wins over userId
- [ ] Consider logging a warning if both are set (test setup may be confused)

---

## Reliability / Flakiness Risks

### R1 — ActionLogger singleton has stale startTime

**File:** `libs/test-framework/src/logging/ActionLogger.ts:18`, `libs/test-framework/src/actions/index.ts:22`

`defaultUIActions` is created once at module load with `performance.now()`. All tests using it get elapsed times relative to module initialization, not test start. Timestamps in logs are misleading.

- [ ] Capture `performance.now()` per-test (e.g., reset in fixture setup), or document that elapsed times are per-worker, not per-test

---

### R2 — describeLocator() may trigger DOM evaluation during logging

**File:** `libs/test-framework/src/actions/describeLocator.ts`

If a locator's `description()` function triggers DOM evaluation, logging itself can slow down tests or cause flakiness.

- [ ] Evaluate whether `description()` is purely string-based or can touch the DOM
- [ ] If DOM-touching: memoize or cache description results

---

### R3 — WebAAABase page fallback uses unsafe cast

**File:** `libs/test-framework/src/core/WebAAABase.ts:15`

If `options.page` is undefined, casts `_instance` to `BasePage<unknown>` and reads `.page`. No type guard.

- [ ] Add runtime check or type guard before the cast
- [ ] Low priority — currently all callers pass valid BasePage instances

---

### R4 — Nested @Step() depth is unbounded

**File:** `libs/test-framework/src/decorators/Step.ts:79`

All decorated methods use `{ box: true }`. Deeply nested calls create deeply indented Playwright reports. No depth limit or warning.

- [ ] Low priority — not a correctness issue, just report clutter
- [ ] Consider adding max-depth logging warning if nesting exceeds 4-5 levels

---

## Minor / Cosmetic

### M1 — Mixed locator strategies in POMs

Some POMs use `this.locate(testId)`, others use `this.page.getByTestId()`, `this.page.getByText()`, or raw CSS selectors. All valid but inconsistent.

- [ ] Standardize on `this.locate()` for testId-based elements where possible
- [ ] Low priority — doesn't affect correctness

---

### M2 — SettingsDrawerPage complexity (~30 locators, 3-level nesting)

Most complex POM in the codebase. Could be split into sub-POMs (GeneralTab, FeesTab, ProfileTab).

- [ ] Evaluate splitting when the page gains more elements
- [ ] Low priority — current structure works, just harder to discover

---

### M3 — Indirect serialization via test.describe.configure()

`settings-aaa.spec.ts` uses `test.describe.configure({ mode: "default" })` instead of `test.describe.serial`. Less clear in intent.

- [ ] Consider switching to `.serial` for clarity, or add a comment explaining why `.configure()` is preferred
