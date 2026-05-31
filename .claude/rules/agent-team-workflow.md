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

## Lock testid strings in `architect-design.md` at Phase 0 (Architect SOP)

When a ticket introduces new `data-testid` strings — for a new component, a new admin-row, a new dropdown, ANY responsive-dual-layout pair (table + card variants per `.claude/rules/responsive-dual-layout-testid-prefixes.md`), or any locator the QA E2E spec or page-object will reference — the Architect MUST enumerate the **locked** testid strings inside `.worklog/team/architect-design.md` BEFORE Phase 1 launches.

The locked list lives in a "Locked testid strings" subsection of the Frontend section of architect-design.md and names the exact string per element (component file path + JSX role + testid string).

**Why:** KZO-196 — the Frontend Implementer landed Phase 1 with internally-chosen testids (`catalog-sector-select`, `catalog-item-{ticker}-industry`). The Architect later issued the canonical strings (`catalog-sector-filter`, `catalog-row-industry-group-{ticker}`) post-DONE. Frontend then had to refactor the component, the page-object locators in `SettingsDrawerPage.ts`, AND the unit-test selectors in lockstep — a full coordination cycle that consumed compute, context, and a Phase 4-equivalent iteration. QA's TDD-red E2E spec also needed re-aligning (it was written against the original strings).

The locked-testid-string convention is deterministic from existing rules:
- Per-row testids: `<surface>-row-<id>` / `<surface>-row-card-<id>`
- Per-action buttons: `<surface>-<action>-btn-<id>` / `-card-<id>` per responsive-dual-layout rule
- New filter inputs / select elements: `<surface>-<field>-filter` (a `<select>` element with `id` + matching `htmlFor` label)
- Per-row sub-element labels: `<surface>-row-<sub-element>-<id>`

Naming the strings explicitly at Phase 0 turns "what testid will the FE component use?" from a coordination cost into a fact. QA can author E2E specs against locked strings without waiting for FE [DONE]; FE writes the component against the same strings without later refactor.

**How to apply:**
- Architect: every architect-design.md for a Tier 2/3 ticket introducing new UI surfaces or admin rows includes a "Locked testid strings" subsection listing each new testid by name. Mid-Phase 1 ad-hoc string locks are a process leak — they signal the design step skipped this enumeration.
- Frontend Implementer: read the locked-testid subsection BEFORE writing any component testid. If a string isn't locked, send `[QUESTION]` to the Architect rather than picking one — pre-empting the refactor cycle.
- QA: write E2E specs and page-object locators directly against the locked strings; do not invent fallback strings.
- Code Reviewer: any PR adding a new `data-testid` whose value differs from the architect-design.md's locked string is a HIGH finding (process violation) — defer to the Architect for ratification or correction.

## Original-agent-revival-during-respawn — park, don't kill (Architect SOP)

When the Architect respawns a silent Implementer per `.claude/rules/team-respawn-verify-not-regenerate.md`, the original (timed-out) tmux pane may still be alive in the background. **Do NOT call `TaskStop` on the original until the respawn agent reports `[DONE]` cleanly.**

**Reasons:**
- The original agent may revive mid-respawn and continue writing — its output may be more authoritative than the respawn agent's VERIFY-only pass (the respawn agent intentionally does not regenerate work).
- If both agents report `[DONE]` consistently against the same on-disk state, that's stronger ratification than one alone.
- Killing the original prematurely loses any in-flight memory notes, terminal output, or partial work the original was holding in its context.

**Pattern:**
1. Architect issues respawn brief to a new agent name (e.g. `backend-implementer-2`).
2. Original `backend-implementer` continues to exist in tmux, idle/silent.
3. If original revives mid-respawn AND its work converges with the respawn agent's verification, issue a `[HOLD]` to the original ("respawn agent is verifying; pause until they report [DONE]") so both don't write to the same files concurrently.
4. After the respawn agent's `[DONE]` lands and verification is clean, the original can be terminated safely (force-stop or shutdown_request).
5. If the original revives with substantively different work after the respawn ratified, treat as Phase 4 finding routing — Architect chooses which version to keep.

**Why:** KZO-196 — Backend Implementer went silent for 34 min. Architect issued respawn (`backend-implementer-2`) with VERIFY-NOT-REGENERATE brief. The original revived ~30s later and reported its own `[DONE]` with the same files green. The respawn agent verified disk state, found nothing to do, and reported `[DONE: zero-touch]`. Net result: two converging confirmations of the same on-disk work, plus a real-time data point that the disk-inventory step + park-don't-kill SOP actually saved compute (the respawn agent verified rather than regenerating ~456 LOC).

**How to apply:**
- Architect: respawn brief is always VERIFY-NOT-REGENERATE per `team-respawn-verify-not-regenerate.md`. Do NOT call TaskStop on the original concurrent with the respawn — leave it parked.
- Team-Lead: when relaying the respawn intent to Dispatcher, explicitly say "park, don't kill the original." Track both agents in `state.json.teammates` (one as `unresponsive`, the other as `in_progress`).
- Dispatcher: do NOT auto-flip the original's task status if a duplicate-name agent appears; both agents may legitimately exist in tmux for a window.
- Force-stop the original only after either (a) the respawn agent's `[DONE]` is verified by the Architect, or (b) the original sends conflicting work that needs resolution.

## Architect ratification discipline — quote the rule's strict-scope clause verbatim

When ratifying an Implementer's "matches sibling precedent" or "matches existing pattern" claim during Phase 3 triage or Code Review, **quote the relevant rule's strict-scope clause verbatim** in the ratification message — do not paraphrase.

The rule may have a narrower scope than the Implementer's claim implies. Paraphrasing during ratification can over-grant ratification beyond what the rule actually says, leading to a reversal cycle when the Code Reviewer or a later inspection reads the rule strictly.

**Pattern:**
```
[ARCHITECT ratification]
Implementer claims: "matches sibling cron precedent (CATALOG/FX/PURGE), env-setup wizard
registration not needed."

Rule strict-scope clause (verbatim from `env-setup-autogen-required-secrets.md`):
> "For every new entry in `libs/config/src/env-schema.ts` with `.min(1)` / `.regex(...)` / no
> `.default(...)` (i.e., would throw at `validateEnvConstraints` when missing): ..."

Ratification: GRANTED. `ASX_GICS_REFRESH_CRON` has `.default('0 2 * * 0')`, so the rule's
checklist does NOT apply. Sibling-cron precedent is consistent with the rule's scope.
```

This pattern catches scope mismatches at ratification time instead of during a Code Review reversal.

**Why:** KZO-196 — Architect ratified Backend's claim that `ASX_GICS_REFRESH_CRON` not appearing in `envGroups` "matches sibling cron precedent." Code Reviewer initially flagged it as MEDIUM-1 missing-rule-compliance; Architect reversed the ratification (treating the finding as valid). On re-reading the rule strictly, the rule's checklist explicitly scopes to env vars WITHOUT `.default(...)`. `ASX_GICS_REFRESH_CRON` HAS a default, so the rule didn't apply — original ratification was correct. The reversal cycle cost a Phase 4 routing decision that had to be undone.

**How to apply:**
- Architect: at every Phase 3 triage where an Implementer cites a rule or precedent, quote the rule's most relevant sentence verbatim before granting/denying ratification.
- Code Reviewer: if the Architect's ratification doesn't quote the rule, send `[QUESTION]` asking which clause is being applied. Don't reverse silently — surface the ambiguity for the Architect to resolve.

## Dispatcher state-rollback prevention on context expiry

When the Dispatcher's TaskList view clears (context window expiry, runtime restart), they MUST NOT roll back `state.json` to a prior phase based solely on TaskList absence. **`state.json` is the authoritative phase source; TaskList is a derived index.**

**The wrong pattern (observed in KZO-196 — 3 occurrences in one run):**
1. Dispatcher's context expires.
2. TaskList returns empty.
3. Dispatcher reconstructs Phase 1 from disk inventory ("backend files exist on disk; tasks must be done").
4. Dispatcher writes `phase: "awaiting-phase-3-go"` and asks the Architect to issue Phase 3 GO.
5. But state.json (before this rewrite) said `phase: "phase-3"` because the Architect had ALREADY fired the GO and the Validator was already running.
6. Dispatcher's rollback creates an artificial "GO needs to fire again" loop that the Architect has to break with `[ARCHITECT:STATE-FIX]` envelopes.

**The correct pattern:**

On any Dispatcher context refresh / restart:
1. **First**: read `state.json` from disk. The `phase` field is authoritative. Push a phase_history entry noting the context refresh.
2. **Second**: read TaskList. If TaskList is empty but state.json says phase=phase-N with active teammates, the tasks need to be RE-CREATED to match the existing phase, not rolled back.
3. **Third**: send a brief `[STATUS]` to the Architect summarizing the resync (NOT asking for a phase GO).

```
[STATUS] Context refreshed. state.json says phase=phase-3, validator + code-reviewer
in_progress. TaskList was empty post-refresh; recreated Tasks #4 (validator) and #5
(code-reviewer) retroactively, both in_progress. Continuing to poll for [DONE]s.
```

**Why:** KZO-196 — Dispatcher's TaskList cleared at least 3 times during the convergence loop. Each time the Dispatcher reconstructed phase from disk inventory and rolled back to "awaiting-phase-N-go," even when the Architect had already issued the GO. Each loop required an `[ARCHITECT:STATE-FIX]` envelope that explicitly named state.json as the authoritative source. The pattern wastes Architect cycles on coordination instead of design.

**How to apply:**
- Dispatcher spawn brief: include this rule verbatim. State.json is authoritative; never roll back phase based on TaskList absence.
- Dispatcher: on every context refresh, the FIRST tool call is reading `state.json`. The SECOND is reading TaskList. Reconcile by recreating tasks to match state, not by rewriting state to match TaskList.
- Architect: if the Dispatcher rolls back state, issue `[ARCHITECT:STATE-FIX]` once. If the rollback recurs, force-stop the Dispatcher and respawn with a brief that re-emphasizes this rule.

## Architect (and Dispatcher) first-action-on-wake = re-poll, always

Every wake — for ANY reason — the Architect's (and Dispatcher's) FIRST action MUST be: re-read inbox / `TaskList` / `state.json` before deciding what to do. Do **not** treat the most recent `[STATUS]` you sent as a polling baseline that means "nothing else needs my attention."

**Why:** The hint channel (SendMessage notifications) is non-authoritative; the durable channel (`TaskUpdate` / `TaskList` / `state.json`) is. Notifications can be dropped, batched, or processed out of order. Skipping the re-poll on a wake where "nothing seems to have changed" is the canonical Architect-stall failure mode.

**Source data point — ui-enhancement run (2026-05-13 → 2026-05-14):** Original `architect` agent stalled **5 separate times** in a single Tier 3 run. Each stall followed the same pattern: send a `[STATUS]`, go idle, fail to re-poll inbox on next wake even though Dispatcher had relayed `[*:DONE]` signals or gate-met confirmations. The failure mode persisted through 5 user-issued prods. User authorized force-stop + respawn after iter 3 of 5; `architect-2` was spawned with explicit polling-discipline instruction and carried convergence to clean iter-5 exit + Wave-2 docs CR + shutdown with **zero further stalls**.

**How to apply:**

- All Architect-role spawn prompts (any tier) MUST include this language verbatim:
  > "Every wake, your FIRST action is re-poll of inbox + TaskList + state.json. Even if you sent a [STATUS] 30 seconds ago, re-check on each wake. If you find any [*:DONE] / [*:FIX_DONE_N] / [DISPATCHER:RELAY] / [DISPATCHER:STATUS] / [DISPATCHER:WAVE_LAUNCHED] message you haven't processed, process it immediately. Skipping the re-poll on a 'nothing seems to have changed' wake is the canonical Architect-stall failure mode — 5-stall precedent in ui-enhancement run, user-authorized force-stop required to recover."

- All Dispatcher-role spawn prompts get the same clause adapted: "On every wake, re-read state.json then TaskList before deciding what to do."

- Main session (team-lead) failure-mode detection: if Architect has been idle ≥10 minutes after a known Dispatcher relay or `[*:DONE]` message landed, send ONE concise prod with the pre-baked next-action embedded ("fire X to Y, then [STATUS] back"). If the prod doesn't unstall within 5 minutes, surface options to the user: (A) wait longer, (B) force-stop + respawn, (C) take over directly, (D) abort + manual finish.

- Recovery precedent: `team-respawn-verify-not-regenerate.md` covers the respawn shape. The ui-enhancement run demonstrated that a respawn architect with **pre-baked triage in the brief** + explicit polling-discipline language can take over mid-convergence and complete cleanly. Memory consolidation from the original architect's staged memory file at `.worklog/team/memory/architect.md` is preserved for handover context.

Companion rules: `team-respawn-verify-not-regenerate.md` (park-don't-kill SOP); `.claude/skills/team/references/message-protocol.md` (durable vs hint channel semantics).

## Holistic audit pattern at 3rd-strike same-class findings

When the convergence loop produces a 3rd consecutive iteration with the **same class** of finding (e.g., "missing X filter" appearing in iter-3, iter-4, and iter-5 CR rounds), the Architect's triage for that iteration MUST include a **holistic grep audit** of the entire surface where the class might apply — not another spot-fix-only routing on the named sites.

**Why:** Spot-fixing individual call sites means each iteration may surface 1–2 more leaks indefinitely. The cost of continued spot-fix iterations exceeds the cost of one comprehensive audit. The audit also produces a durable artifact (commit message + scope-todo addendum) that future code reviews can grep against.

**Source data point — ui-enhancement run, iter 5 (FINAL ceiling):** Pattern of soft-delete filter leaks:
- iter 3 CR found 2 HIGHs in `getSnapshotGenerationInputs` + `getAggregatedSnapshotsInReportingCurrency`
- iter 4 CR (holistic audit recommended by original architect's risk-hedge but not yet enforced) found 1 HIGH (`getMonitoredSet`) + 1 MEDIUM (`listDividendLedgerYears`)
- iter 5 Backend was directed to do a comprehensive `grep -nE "FROM accounts|JOIN accounts" apps/api/src/persistence/postgres.ts` audit + per-match decision (apply filter / add justification comment / declare intentional exception).
- **Result: 9 filter sites in total — 2 directed fixes + 7 defensive sites the spot-fix-only path would have missed entirely.** One of the 7 (`listUserAccountIds` ~5236) was on a replay path that, if hit without the filter, would have caused **real data loss** for soft-deleted accounts.

**How to apply:**

- Architect triage rule of thumb: **3rd consecutive iteration of same-class finding → mandate holistic grep audit** with per-match decision (apply filter / add justification comment / declare intentional exception). Reject another spot-fix-only routing.
- Backend (or relevant implementer) MUST surface the grep output + decisions in their `[*:FIX_DONE_N]` summary so CR can verify the audit was actually performed and the decisions are reasonable.
- Code Reviewer should grep the same pattern independently as part of their delta CR when audit is in scope, and flag any unaccounted matches as HIGH.

**On structural refactors as an alternative:** The "third strike" data point is also evidence that the underlying API allows the class of bug — e.g., direct `WHERE user_id = $1` SQL without account-active-status filtering. A structural refactor (e.g., mandate all account-scoped reads flow through a single `active_account_ids` CTE; reject any direct SELECT without it) is a stronger guarantee but high blast radius. **Default decision: defer the refactor to a follow-up ticket** unless iteration ceiling is far from exhausted. The transition note's `## Follow-up: ...` section is the canonical place to record that deferred work + the original architect's risk-hedge proposal. Apply the holistic audit now for immediate correctness; structurally refactor later.

**Generalizes beyond soft-delete:** apply to any recurring same-class finding (e.g., 3rd-strike missing route-guard, 3rd-strike missing rate-limit, 3rd-strike missing audit-log entry, 3rd-strike missing schema-qualified table name in raw SQL, 3rd-strike missing typed-error re-throw).

Companion rules: `code-review-before-pr.md`, `team-phase-3-triage.md` (route holistic-audit findings + planned-Wave-2 docs items correctly).
