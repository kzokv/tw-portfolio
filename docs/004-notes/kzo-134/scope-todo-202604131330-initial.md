---
slug: kzo-134
source: scope-grill
created: 2026-04-13
tickets: [KZO-134]
required_reading:
  - docs/004-notes/kzo-37/scope-todo-202604091700-initial.md
  - .agents/skills/tw-market-bookkeeping/references/tw-market-rules.md
  - .agents/skills/tw-market-bookkeeping/references/tw-bookkeeping-examples.md
  - libs/domain/src/dividend-deductions.ts
  - libs/shared-types/src/index.ts
  - .claude/rules/full-test-suite.md
  - .claude/rules/nextjs-i18n-serialization.md
  - .claude/rules/playwright-fast-sse-assertions.md
  - .claude/rules/e2e-aaa-guardrails.md
  - .claude/rules/process-refactor-rename-verification.md
superseded_by: null
---

# Todo: KZO-134 — ETF distribution source-aware tax & NHI projection

> **For agents starting a fresh session:** read all files in `required_reading`
> before starting. KZO-37 is the foundation — skim its todo for the persistence
> and domain patterns this ticket builds on.

---

## Phase 0 — Domain (`libs/domain`)

- [x] Export `NHI_SUBJECT_BUCKETS = new Set<DividendSourceBucket>(["DIVIDEND_INCOME", "INTEREST_INCOME"])` from `dividend-deductions.ts` alongside `NHI_RATE`
- [x] Replace `NhiPremiumPrefill` interface with `NhiPremiumPrefillResult` discriminated union:
  `{ kind: "exact"; premiumBase: number; premiumAmount: number } | { kind: "estimate"; premiumBase: 0; premiumAmount: 0 }`
- [x] Update `prefillNhiPremium` signature — add optional `sourceLines?: SourceLineLike[]` and `sourceCompositionStatus?: SourceCompositionStatus`
- [x] Update `prefillNhiPremium` logic:
  - `ETF | BOND_ETF` + `unknown_pending_disclosure` → `{ kind: "estimate", premiumBase: 0, premiumAmount: 0 }`
  - `ETF | BOND_ETF` + `provided` → filter `NHI_SUBJECT_BUCKETS`, sum amounts; if ≥ `NHI_THRESHOLD_TWD` → `{ kind: "exact", premiumBase, premiumAmount }`; else → `null`
  - Non-ETF: existing logic, return value wrapped as `{ kind: "exact", ... }` or `null`
- [x] Grep all callers of `prefillNhiPremium` repo-wide; update each to pass `sourceLines` and `sourceCompositionStatus` where available (per `.claude/rules/process-refactor-rename-verification.md`)
- [x] Update `libs/domain/test/dividend-deductions.test.ts`:
  - [x] Rewrite ETF→null test as: `unknown_pending_disclosure → { kind: "estimate" }`
  - [x] ETF + `provided` + NHI-subject sum ≥ NT$20,000 → `{ kind: "exact" }`
  - [x] ETF + `provided` + all non-NHI buckets → `null`
  - [x] ETF + `provided` + sum < threshold → `null`
  - [x] Canonical 00919 case: `DIVIDEND_INCOME 900 + INTEREST_INCOME 300 + REVENUE_EQUALIZATION 200 + CAPITAL_RETURN 100` → NHI-subject NT$1,200 < threshold → `null`
  - [x] Canonical 0056 case: NHI-subject sum ≥ NT$20,000 → exact premium at 2.11%
  - [x] Non-ETF: existing passing cases now return `{ kind: "exact" }` shape

---

## Phase 1 — Web: Source Composition Tab

- [x] Create `SourceCompositionTab` component (`apps/web/components/dividends/SourceCompositionTab.tsx`):
  - [x] **Exact state** (`provided`): bucket table (Chinese name, amount, NHI subject ✓/✗) + NHI-subject subtotal row + projected premium row
  - [x] **Estimate state** (`unknown_pending_disclosure`): same table structure, all amounts NT$0, inline warning `⚠ Estimated NT$0 — enter source lines for exact computation.`
  - [x] **Responsive**: table layout ≥ sm breakpoint; wrap/card layout (bucket name + amount stacked) below sm
- [x] Add i18n strings for source bucket display names and tab UI to `features/dividends/i18n.ts` (string templates only — no functions per `.claude/rules/nextjs-i18n-serialization.md`)
- [x] Wire Source Composition tab into the posting drawer:
  - [x] Render tab only when `instrumentType === "ETF" || instrumentType === "BOND_ETF"`
  - [x] `⚠` badge on tab label when `sourceCompositionStatus === "unknown_pending_disclosure"`
- [x] Update `DividendPostingForm.tsx` — handle `prefillNhiPremium` discriminated union result:
  - [x] `{ kind: "estimate" }` → prefill NT$0, show inline warning beneath NHI deduction field
  - [x] `{ kind: "exact" }` → prefill as before, no warning
  - [x] `null` → no prefill, no warning (unchanged)

---

## Phase 2 — Web: Annual NHI Rollup Section

- [x] Create `NhiRollupSection` component (`apps/web/features/dividends/components/NhiRollupSection.tsx`):
  - [x] Client-side aggregation: filter `ETF | BOND_ETF` entries from `DividendLedgerEntryDetails[]`, flatten `sourceLines`, sum amounts by bucket
  - [x] Bucket table: Chinese bucket name, total amount, NHI subject column
  - [x] NHI-subject subtotal row + projected premium row (`× 2.11%`)
  - [x] `⚠ N entries pending disclosure` as clickable link (calls `onFilterPending` prop)
  - [x] **Empty state**: "No ETF distributions recorded for {year}" when no ETF/BOND_ETF entries
  - [x] **Responsive**: table ≥ sm; wrap/card layout below sm
- [x] Add i18n strings for rollup section to `features/dividends/i18n.ts`
- [x] Integrate `NhiRollupSection` into `/dividends/review` page below or above the ledger table
- [x] Handle `?sourceComposition=pending` URL param:
  - [x] On mount: if param present, pre-apply client-side filter to show only `unknown_pending_disclosure` entries
  - [x] `onFilterPending` callback sets `?sourceComposition=pending` in URL and applies filter

---

## Phase 3 — Tests

### Web unit tests (`apps/web/test/`)
- [x] `NhiRollupSection` aggregation pure helper:
  - [x] Correct bucket totals across multiple entries
  - [x] Correct pending count
  - [x] Correct NHI-subject total and projected premium
  - [x] Empty state when no ETF entries
- [x] `DividendPostingForm`:
  - [x] ETF + `unknown_pending_disclosure` → estimate warning visible beneath NHI field
  - [x] ETF + `provided` + sum ≥ threshold → no warning, NHI prefilled
  - [x] Non-ETF → no warning (unchanged)
- [x] `SourceCompositionTab`:
  - [x] Exact state renders bucket table with correct NHI subtotal
  - [x] Estimate state renders zero + warning
  - [x] Not rendered for `STOCK`

### E2E tests (Playwright)
- [x] Check if `DividendsArrange` in `libs/test-e2e` supports setting `sourceLines` + `sourceCompositionStatus`; extend if not
- [x] Add E2E scenarios (new file `specs/dividend-source-aaa.spec.ts` or extend `dividend-calendar-aaa.spec.ts`):
  - [x] Source Composition tab visible for ETF entry with `provided` source lines; bucket breakdown correct
  - [x] `⚠` badge on tab for ETF entry with `unknown_pending_disclosure`; estimate state shown
  - [x] Source Composition tab NOT rendered for STOCK entry
  - [x] Annual NHI rollup section always visible on `/dividends/review`
  - [x] `⚠ N entries pending disclosure` link sets `?sourceComposition=pending` and filters ledger table
  - [x] Responsive — Source Composition tab: narrow viewport (375px) renders card/wrap layout
  - [x] Responsive — NHI rollup section: narrow viewport (375px) renders card/wrap layout
- [x] Run full 7-suite test pass before marking complete (per `.claude/rules/full-test-suite.md`)

---

## Open Items
- [ ] KZO-138 — ETF source-line importer (LLM-based, password-encrypted PDF) — blocked by KZO-134

## Deferred (LOW severity — not blocking KZO-134)
- Dead `prefillNhiPremium` export in `libs/domain/src/dividend-deductions.ts` — no production callers outside tests (pre-existing pattern)
- ESLint `exhaustive-deps` warning in `DividendReviewClient.tsx` — intentional mount-only effect, suppressed

## References
- Follow-up ticket: KZO-138
- Linear: https://linear.app/kzokv/issue/KZO-134
