# Fixer Scope Guardrail

When the Fixer encounters test failures caused by test environment/setup issues (not production bugs), they must send `[QUESTION]` to the Architect rather than modifying production code.

**Signal to watch for:** The same module fails across consecutive iterations, or the fix would require changing auth plumbing (`app.ts`, `registerRoutes.ts`) to accommodate a specific test's expectations.

**For Architect task descriptions to the Fixer:** Explicitly list which files are in-scope. Add: *"Do NOT modify [production files] — if the fix requires production changes, send [QUESTION] to the Architect."*

**Why:** In KZO-78 iteration 1, the Fixer modified `app.ts` and `registerRoutes.ts` to make `dev_bypass` mode reject unauthenticated requests. This caused 24 E2E regressions (OAuth route startup returned 503). The actual issue was that the integration tests were running in the wrong auth mode — a test setup problem, not a production bug. The correct fix was `vi.mock("@vakwen/config")` at the test-file level.

**How to apply:** When assigning fix tasks, name production files as out-of-scope when the bug is suspected to be in test setup. If the Fixer self-routes to `[QUESTION]` on scope ambiguity, treat that as correct behavior.
