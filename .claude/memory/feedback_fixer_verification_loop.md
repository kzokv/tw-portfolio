---
name: feedback_fixer_verification_loop
description: Fixer role uses a red-green verification loop, not TDD — must run full suite for the affected test area before reporting DONE
type: feedback
---

The Fixer must follow a **red-green verification loop**, not TDD. Full TDD (writing new failing tests first) belongs with the Implementer.

**Why:** In KZO-74, the Fixer introduced regressions twice by confirming the target test passed and stopping there — never running the broader E2E suite the config change affected. Both regressions were infrastructure/config-level side effects that no unit test could catch:
1. Adding a `webServer` entry to `playwright.oauth.config.ts` caused `ERR_ABORTED` across E2E oauth tests
2. A `vitest setupFiles` change affected test runtime behavior globally

**How to apply — Required 4-step loop for every Fixer fix:**
1. 🔴 **Red** — reproduce the exact failure: run the specific failing test, confirm it fails with the reported error
2. 🔧 **Fix** — apply the change
3. 🟢 **Green** — run the specific test, confirm it passes
4. 🔁 **Sweep** — run the **full suite the test belongs to**: for E2E config changes → run ALL E2E suites; for unit config changes → run full unit suite. Report the suite result explicitly before sending `[DONE]`.

The Fixer should only write a new test when the fix reveals a coverage gap that would cause a silent regression. This is situational, not a default.

**Additional rule — do not modify production auth code for test-only issues:**
If a test fails because of auth mode semantics (e.g. 401 not firing in dev_bypass mode), the fix belongs in the test setup, not in `app.ts` or `registerRoutes.ts`. Changing production auth plumbing to satisfy a test will cause E2E regressions. See `feedback_vitest_auth_mode_override.md` for the correct pattern.
