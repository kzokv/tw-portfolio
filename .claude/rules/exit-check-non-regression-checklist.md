# Exit Check: Non-Regression Ruling for Isolated Failures

When the convergence loop's exit check encounters a failing test that appears unrelated to the ticket's blast radius, the Architect may rule it a pre-existing non-regression and accept the exit check — but only after completing a structured 5-point verification. A verbal "this looks unrelated" is insufficient.

## 5-point verification checklist

All five must hold to accept the exit check with a failing test:

1. **File predates the ticket** — verify the failing spec file existed before this ticket's first commit. Use `grep` or `git log` to confirm the file is not KZO-172-introduced. If it was introduced by this ticket, it cannot be a pre-existing flake.

2. **Zero diff overlap** — verify no KZO-172 commit touches the failing test's code path. Run `git diff --stat | grep -iE "<relevant-keyword>"`. If any diff output appears, treat the failure as potentially regression-caused and investigate before accepting.

3. **Failure mode classification** — classify the failure signature:
   - **Timeout/race** (e.g., single `toBeVisible()` timeout, `expect(el).toBeVisible` failing with "element not visible in N ms") → leans pre-existing flake
   - **Assertion mismatch** (e.g., `expected "X" but got "Y"`) → leans regression; requires diff-overlap check
   - **ECONNREFUSED / port conflict** → infrastructure-class; check for orphan processes (see `validator-process-hygiene.md`), not a flake
   - **Import/type error** → almost never a flake; always investigate

4. **≥2 independent data points** — the same test must have failed in at least 2 distinct runs. A single failure in a single run is insufficient evidence. Unauthorized validator runs count as independent data points as long as they occurred at different times and were not part of the same suite invocation.

5. **CR-confirmed no production code changes** — the Code Reviewer must have confirmed that no production source code was modified between the last green run of the failing test and the current Phase 5 run. "Phase 4 edits confined to test files + provider stubs" is the expected form of this confirmation.

## Ruling format

When ruling an exit check with a failing test, document the ruling in `state.json` exit_check:

```json
{
  "exit_check": {
    "tests_green": true,
    "findings_addressed": true,
    "no_regressions": true,
    "ruling": "[EXIT_CHECK_PASS] Architect-issued 2026-05-05. <spec>:<line> — pre-existing flake: (1) file predates ticket ✓, (2) zero diff overlap ✓, (3) single toBeVisible timeout ✓, (4) 2 independent failure data points ✓, (5) CR confirms no production code modified ✓."
  }
}
```

The ruling must name the failing test and explicitly reference the 5-point check. Vague statements like "probably a flake" are not acceptable rulings.

## What happens if the checklist reveals uncertainty

If ANY of the 5 points is unclear or fails:
- Run `git log --oneline <failing-spec-file>` to establish file age
- Ask the Code Reviewer to do a targeted diff scan on the relevant module
- If still uncertain after 2 investigation steps → require another convergence iteration with a targeted fix attempt

**Do not accept the exit check on heuristics alone.** The cost of a false acceptance (shipping a regression) is higher than the cost of one more iteration.

## Wave 2 documentation

The Technical Writer must acknowledge any exit-check ruling in the transition note. The acknowledgment should include:
- The failing spec and line number
- The ruling outcome (pre-existing / accepted / investigated)
- Any recommendation for a follow-up ticket if the pattern persists

## Why this is a rule

KZO-172 Phase 5 — `tooltips-a11y-aaa.spec.ts:30` failed ("transaction tooltips and shell controls stay focusable"). All 5 checklist items verified:
1. File predates KZO-172 (confirmed via grep).
2. `git diff --stat | grep -iE "tooltip|a11y"` returned empty.
3. Single `toBeVisible()` timeout — classic element-readiness race in hover/focus animation.
4. Same test appeared in unauthorized Iter 2 flake list AND in legitimate Phase 5 results — 2 independent data points.
5. Code Reviewer confirmed Phase 4 edits were strictly test files + provider stubs.

Without the checklist, the acceptance would have been a judgment call. With it, each point became an explicit verification step that the Architect and Code Reviewer could independently confirm, producing an auditable record.

## How to apply

- At every convergence-loop exit check where any suite has a failure.
- Even for "obvious" flakes — the checklist is fast (3-5 minutes) and produces a documentable ruling.
- The Code Reviewer is a natural co-verifier for point (5); include in the exit-check triage message.
- Companion rules: `validator-process-hygiene.md` (for ECONNREFUSED failures), `validator-activation-gate.md` (for unauthorized run data points).

## Empirical validation: discipline scales under cumulative pressure

KZO-195 produced **four** distinct stochastic suite-6 / suite-7 flakes across iters 4-7, each routed cleanly through the 5-point checklist with no devolution to "looks like a flake" judgment:

- `tooltips-a11y-aaa.spec.ts:30` — triple-confirmed canonical (KZO-172 + KZO-195 iter 5 + iter 7 reset because of the iter-6 fix)
- `dashboard-timeframe-aaa.spec.ts:192` (timeframe-L) — graduated from 1 → 5/5 ruling with iter 3 + iter 7 + iter 8 = **3 independent data points**
- `monitored-tickers-aaa.spec.ts:64` — single occurrence iter 4, self-resolved iter 5 (correct: insufficient data, deferred ruling)
- `account-fee-profiles-aaa.spec.ts:53` — single occurrence iter 7, deferred for 2nd data point (never came)

**The lesson:** point 4 (≥2 data points) is the load-bearing safeguard. Under pressure to ship, the temptation is to rule from a single occurrence + the other 4 points satisfied. Don't. The KZO-195 case shows the checklist holds up across many flakes in one ticket precisely because the data-point requirement forces a true wait-and-see; the 4-point rulings (`monitored-tickers`, `account-fee-profiles`) correctly stayed deferred and never required action.

**How to apply (reinforcement):** Even when the failure mode signature is unmistakable (timeout shape, hover/focus race, async network jitter), point 4 is non-waivable except in the explicit "infrastructure-class" case (ECONNRESET / ECONNREFUSED) where the rule already classifies on signature alone. For all other classes, defer the ruling until 2 occurrences land; if it self-resolves, the deferral cost was zero and the audit trail is cleaner.
