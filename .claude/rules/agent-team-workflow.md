# Agent Team Workflow (/team skill)

The user's preferred multi-agent implementation pattern is the `/team` skill. These are the load-bearing design decisions — follow them when running `/team` or orchestrating multi-agent work manually.

## Tiers

Three tiers exist; Claude recommends based on task complexity and the user approves:

- **Solo** — 4 agents (smallest scope, tight feedback loop)
- **Squad** — 6 agents
- **Full Team** — 8 agents (includes dedicated Memory Curator wrap-up)

Pick the smallest tier that fits. Over-tiering small tasks wastes coordination overhead; under-tiering large ones produces thin coverage.

## Roles and ownership

- **Architect is the team lead** — trust-but-escalate model. Other agents report to the Architect, not to Claude directly.
- **Implementer** writes source code and updates implementation-coupled tests that break due to source changes (see `implementer-qa-test-ownership.md`).
- **QA writes test scripts at all tiers**, but the full two-phase QA ceremony (plan → execute) runs only at Tier 3.
- **Fixer** addresses review/validation findings and test failures — single merged role (no separate Resolver).
- **Code Reviewer** runs inside the convergence loop, in parallel with the Validator during Phase 3.
- **Memory** — Architect owns memory updates at Tier 1-2; dedicated Memory Curator wrap-up at Tier 3.

## Convergence loop

- Default: **3 iterations**. The Architect may extend to 5 before hard-escalating to the user.
- **Architect self-check:** if the same area fails two consecutive iterations, re-evaluate the design before the Fixer runs again. Same-area repeated failure is a design-level signal, not a fix-level one.

## Tier 2 — Phase 1 and Phase 2 run in parallel

At Tier 2, the QA and Implementer tasks are created together at launch. Phase 1 is not "implementation first, then QA" — it is a single merged wave where both teammates work simultaneously. The Phase 3 gate is "both Task #1 (Implementer) AND Task #2 (QA) completed," not a sequential handoff.

**Architect briefing must say this explicitly.** When briefing the Dispatcher at launch:

- Create BOTH Task #1 (Implementer) AND Task #2 (QA) at Phase 1 start.
- QA writes tests against the locked scope; files are TDD-red until the Implementer lands source.
- The Phase 3 [GO] fires only when both tasks are complete.

**Why (incident-learned — KZO-152):** The Architect briefed a sequential Phase 1 → Phase 2 flow. The Dispatcher had already pre-created Task #2 alongside Task #1 per Tier 2 protocol, which forced a reconciliation round-trip. Net effect: wasted one coordination cycle. The correct Tier 2 default is the parallel one — it is encoded in the `/team` skill's role definitions.

**How to apply:** Applies to every Tier 2 (Squad) run. Does NOT apply to Tier 3 (Full Team), where QA runs a two-phase plan → execute ceremony and the checkpoint review happens between those phases.

### Dispatcher launch-round timing — do not issue `[ARCHITECT:CHECK]` prematurely

After briefing the Dispatcher to launch Phase 1, the Architect should **wait at least 30 seconds** before checking whether both Task #1 and Task #2 appear in `TaskList`. The Dispatcher creates tasks in a single turn but `TaskList` may lag by one polling cycle before both tasks are visible.

Issuing `[ARCHITECT:CHECK]` immediately after launch is a false-alarm pattern: the Dispatcher is often still in its launch turn when the Architect reads `TaskList` and sees only Task #1. The check-in is harmless but generates noise and a round-trip delay.

**Options (pick one per run):**
- Wait ≥30s after briefing before calling `TaskList` for verification.
- Add `[DISPATCHER:LAUNCHING]` as a pre-task ack (Dispatcher sends before creating tasks; Architect waits for it before checking TaskList).

**Why (KZO-188):** Architect issued `[ARCHITECT:CHECK]` immediately after the Dispatcher's launch brief. The Dispatcher was mid-turn creating Task #2 when the Architect read TaskList and saw only Task #1. The false alarm crossed with the launch completion with no actual harm, but added a round-trip message exchange. The 30s wait would have avoided it entirely.

**How to apply:** All Tier 2 runs. The Dispatcher's `[DISPATCHER:READY]` / `[DISPATCHER:WAVE_LAUNCHED]` ack is the authoritative signal — wait for it rather than polling TaskList directly after briefing.

## Task description amplification (both Implementer and QA)

When a scope-todo cites a "precedent file to mirror" but is vague on exact type signatures (e.g. "handler takes a Job" vs the precedent's `JobWithMetadata<T>[]`), the Architect must call out the precedent explicitly in BOTH the Implementer's and QA's task descriptions. Both teammates will converge independently on the precedent shape, which is the correct outcome — but only if they both know to look at it.

**Why (KZO-152):** The scope-todo loosely described `createAnonymousShareTokenPurgeHandler(deps)` without pinning the job argument type. The Implementer and QA both independently arrived at `JobWithMetadata<Record<string, never>>[]` because both read `registerCatalogSyncWorker.ts` as precedent. No reconciliation needed. This is the right pattern — enforce it by naming the precedent in both task descriptions, not just one.

**How to apply:** Any task description whose source spec cites a precedent file. Name the precedent file + line numbers in both Implementer and QA task descriptions.

## Validator gating (incident-learned — KZO-74)

The Validator runs **only** after the Architect sends an explicit `[GO]` signal, confirming all blocking tasks are complete. The Validator **must NOT self-activate** based on task completion events.

**Why:** In KZO-74, the Validator ran after Task #1 completed but before Task #2 finished. It produced mixed pass/fail results that wasted a full validation cycle and polluted the state file. The `[GO]` gate was added so the Architect — the only agent with full visibility across blocking dependencies — makes the decision.

## State tracking

`.worklog/team/state.json` is the single source of truth for loop control and phase tracking. Agents read and write this file; Claude uses it to drive scheduling. Do not treat agent-chat transcripts as state.

**How to apply:** Use the `/team` skill, which handles tier recommendation, agent spawning, state tracking, and tier scaling. When orchestrating multi-agent work manually, honor the validator `[GO]` gate and the convergence-loop bounds even without the skill wrapper.

## Verification gates are contracts (incident-learned — KZO-142)

When a design doc or scope-todo lists a verification gate (e.g. "run suites 4+5+admin E2E before declaring Phase 1 done"), it is an enforceable contract, not a suggestion. The Dispatcher (or Architect at Tier 1) should check whether the completing agent's task result notes confirm the gate was satisfied before sending `[GO]` to the Validator. If a required suite is absent from the result notes, treat the phase as incomplete and request the missing run.

**Why:** In KZO-142, the Backend Implementer skipped suite 6 (E2E), reasoning it was "pure-refactor, E2E is QA's scope." QA ran it clean one phase later — no regression. But a broken extraction would only have been caught in QA's next phase, wasting a convergence cycle.

## QA's TDD-red imports can drive helper extraction (Implementer should default to extract)

When QA writes a TDD-red test that imports from a file path the scope-todo never literally named (e.g., `formatAccountOption` from `apps/web/features/cash-ledger/utils/accountOptions.ts` while the scope-todo only said "the dropdown reads `formatType(account.accountType, t)`"), the Implementer's correct call is usually to **extract the helper rather than push back via `[QUESTION]`**.

The scope-todo's silence on a specific extraction path is most often a documentation gap, not an opinion against extraction. Default to extract when ALL of the following hold:

- The helper would be genuinely pure (no React state, no i18n function values, no service-layer side effects).
- Extraction does not violate any existing rule — in fact, often satisfies one (e.g., `nextjs-i18n-serialization.md`'s "function lives outside the i18n dictionary").
- Both the scope-todo's wording and QA's import resolve to the same conceptual surface (the call site looks identical from the consumer's perspective).
- The extraction does not change behavior, only file layout.

If any of those fail (extraction would change behavior, violate a rule, or land at a fundamentally different surface), THAT's when `[QUESTION]` to the Architect is correct.

**Why:** KZO-167 — QA's `accountOptions.test.ts` imported `formatAccountOption` from `utils/accountOptions.ts`, a path the scope-todo never named. The Implementer extracted the helper rather than pushing back, and the result satisfied `nextjs-i18n-serialization.md` cleanly. A `[QUESTION]` round-trip would have stalled the parallel Phase 1+2 launch by a coordination cycle.

**How to apply:**
- Implementer rule of thumb: when QA's TDD-red import path differs from the scope-todo's wording but the conceptual surface is the same, extract first, ask later.
- QA rule of thumb: prefer importing from a plausible `utils/` location even if the scope-todo doesn't name it — the Implementer can extract on receipt.
- Architect rule of thumb: do NOT route this as a finding in Phase 3 if it lands cleanly. The implicit extraction is part of Tier 2's "QA writes scripts proactively" contract.
- Companion rule: `nextjs-i18n-serialization.md` is the most common destination for this pattern (helpers MUST live outside i18n dicts).

## QA assertion scope-bleed — audit inherited negations when modeling new test cases

When QA models a new test case on an existing sibling (copy-and-modify), inherited negative assertions (`expect(fn).not.toHaveBeenCalled(...)`, `expect(fn).not.toHaveBeenCalledWith(...)`) must be audited for scope correctness. A sibling that tests a failure path may have negations that are NOT true for the new gating condition's success path.

**Audit question for each inherited `not.toHaveBeenCalled*` assertion:**
> "Does this behavior CHANGE under the new gate I'm testing, or does it remain the same as it was before my feature landed?"

If the answer is "remains the same as before," the assertion is out of scope for the new test case and should be removed. The inherited assertion describes the sibling's feature, not the new one.

**Symptom:** A new test case fails with "expected function NOT to have been called, but it was called 1 time." The function call is correct pre-existing behavior — the inherited assertion is wrong for the new path, not the code.

**Why:** KZO-189 Suite 4 iter 1 — QA modeled the `conditional × daily_refresh` (enrichment-skip) test case on the failure-path sibling in `backfill-handler-branching.test.ts`. The sibling's `expect(updateBackfillStatus).not.toHaveBeenCalledWith('BHP', 'ready')` was correct for the failure path but wrong for the skip path, where enrichment is skipped but the handler completes successfully — `updateBackfillStatus('BHP', 'ready')` IS called (unchanged from pre-KZO-189). The fix was 1-line removal in Phase 4; finding it cost a full convergence iteration.

**How to apply:** QA self-check before `[DONE]`: for every `not.toHaveBeenCalled*` assertion in a new test case, confirm it is testing something that the new gate feature actually changes — not inherited from a sibling that tested something else entirely.
