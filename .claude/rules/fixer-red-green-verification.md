# Fixer Red-Green Verification Loop

The Fixer must follow a **red-green verification loop** for every fix. Full TDD (writing new failing tests first) belongs with the Implementer.

**Required 4-step loop for every fix:**
1. RED — reproduce the exact failure: run the specific failing test, confirm it fails with the reported error
2. FIX — apply the change
3. GREEN — run the specific test, confirm it passes
4. SWEEP — run the **full suite the test belongs to**: for E2E/config changes → run ALL E2E suites; for unit/config changes → run full unit suite. Report the suite result explicitly before sending `[DONE]`.

Do NOT write a new test unless the fix reveals a coverage gap that would cause a silent regression. This is situational, not default.

**Do not modify production auth code for test-only issues:**
If a test fails because of auth mode semantics (e.g. 401 not firing in dev_bypass mode), the fix belongs in the test setup, not in `app.ts` or `registerRoutes.ts`. Changing production auth plumbing to satisfy a test will cause E2E regressions.

**Why:** In KZO-74, the Fixer introduced regressions twice by confirming only the target test passed — never running the broader suite the config change affected. Both regressions were infrastructure/config-level side effects invisible to single-test verification. Reinforced in KZO-114 (7-iteration convergence partially due to incomplete sweep).

**How to apply:** Any time the Fixer role is assigned work in a `/team` session, or when fixing test failures outside of a team context.

## SWEEP-waiver for provably unreferenced symbols

When the changed symbol is **provably unreferenced** — a private page-object locator used in no spec, an unused export, a dead constant — the Architect may waive the full-suite SWEEP and require **lint + typecheck only**.

Criteria for the waiver (ALL must hold):
1. The changed symbol is not imported or called in any spec or production file (grep-verified)
2. The change is non-behavioral (rename / string correction; not logic or type signature)
3. The Architect explicitly documents the waiver in the fix task's `TaskUpdate` result

```
# Architect's waiver note in TaskUpdate:
result: "CLEAN — lint+typecheck only; SWEEP waived. Locator 'catalog-live-searching'
         unreferenced in any spec (grep confirms 0 call sites). Non-behavioral string fix."
```

**Why:** KZO-188 Phase 4 — `SettingsDrawerPage.ts:358` testid string `catalog-live-searching` → `catalog-live-loading`. The locator had 0 spec references. Running the full 8-suite gate (~8 min) for a 1-character locator correction with zero behavioral impact would have burned compute and iteration time with no coverage gain. The waiver cost nothing; the grep verification is the safeguard.

**How to apply:** Architect issues the waiver in the `[TRIAGE]` message; Fixer runs lint + typecheck only and quotes the waiver in their `[DONE]` message. The Code Reviewer verifies the grep claim in Wave 2 docs review if the fix is flagged.
