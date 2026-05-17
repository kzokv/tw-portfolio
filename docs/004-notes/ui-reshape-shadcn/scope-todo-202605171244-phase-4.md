---
slug: ui-reshape-phase-4
source: scope-grill
created: 2026-05-17
tickets: []
required_reading:
  - docs/004-notes/ui-reshape-shadcn/design-202605151200-locked-scope.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md
  - .claude/rules/responsive-dual-layout-testid-prefixes.md
  - .claude/rules/playwright-page-object-testid-drift.md
  - .claude/rules/playwright-web-bundle-rebuild.md
superseded_by: null
---

# Todo: Phase 4 — DataTable migration (retire dual-DOM)

> **For agents starting a fresh session:** read all files listed in `required_reading` before starting implementation. This todo supersedes the Phase 4 line items in `scope-todo-202605151201-phases.md` (which had an inaccurate table inventory — corrected per Phase 0 grep audit below).

Waiver track per `commit-format.md` (`ui-enhancement`; no Linear ticket; PR carries `waiver:linear-ticket` label with `## Waiver` section).

## Scope correction vs original Phase 4

Grep audit (`hidden lg:block | lg:hidden | sm:hidden | md:hidden`) showed the original Phase 4 file list was wrong on both ends:

- **5 tables were missing** from the original list (real dual-DOM consumers): `CashLedgerClient`, `NhiRollupSection`, `DividendReviewClient`, `SourceCompositionTab`, `RecentTransactionsCard`.
- **4 tables were listed but had no card-variant** (already single-DOM): `FeeProfilesTable`, `AdminAuditLogClient`, `AdminUsersClient`, `AdminInvitesClient`. These move to Phase 7 cosmetic adoption.
- **2 tables not on either list** are also single-DOM with no card variant: `OutboundSharesTable`, `AnonymousLinksTable`. Phase 7 evaluation.

**Phase 4 scope = 9 dual-DOM tables.**

---

## Per-table responsive plan

| # | Table | `<md` | `<sm` | Sticky col | Commit |
|---|---|---|---|---|---|
| 1 | `AdminProvidersClient.tsx` | scroll | **card-stack** | provider | 4b |
| 2 | `AdminInstrumentsClient.tsx` | scroll | scroll | ticker | 4c |
| 3 | `NhiRollupSection.tsx` | scroll | scroll | — (small) | 4d |
| 4 | `SourceCompositionTab.tsx` | scroll | scroll | — (small) | 4d |
| 5 | `RecentTransactionsCard.tsx` | scroll | **card-stack** | date | 4e |
| 6 | `CashLedgerClient.tsx` | scroll | scroll | date | 4f |
| 7 | `DividendReviewClient.tsx` | scroll | **card-stack** | ticker | 4g |
| 8 | `HoldingsTable.tsx` | scroll | scroll | ticker | 4h |
| 9 | `TransactionHistoryTable.tsx` | scroll | **card-stack** | date | 4i |

All scroll-tables get sticky first column at `<md` via `stickyFirstColumn` prop.

---

## Commit cadence (10 commits)

### Commit 1 — `feat(web): add DataTable wrapper + table primitive (Phase 4a)`

- [ ] `npx shadcn@latest add -c apps/web table`
- [ ] Create `apps/web/components/ui/DataTable.tsx` — thin wrapper on shadcn `<Table>`. API:
  - `columns: { key, header, render, priority?: 'lg' | 'md' | 'sm' }[]` — emits `hidden md:table-cell` / `hidden lg:table-cell` per priority.
  - `data: T[]`
  - `stickyFirstColumn?: boolean` — emits `position: sticky; left: 0; bg: card; z-1` on first `<th>` + `<td>`. z-index documented in component header (below shadcn `Popover`/`Tooltip` z-50).
  - `mobileRow?: (row: T) => ReactNode` — render fn for `<sm` card-stack variant. Wrapper conditionally renders cards via `<div className="sm:hidden">` + table via `<div className="hidden sm:block">` when `mobileRow` provided; pure scroll when not.
  - `renderRow?: (row: T) => ReactNode` — escape hatch (used by `TransactionHistoryTable` for `EditableTransactionRow`).
  - `emptyState?: ReactNode` — optional null/skeleton.
- [ ] Consume `--row-h` CSS variable from Phase 2 density token.
- [ ] No new i18n keys; wrapper renders no text directly.
- [ ] Create `apps/web/test/components/ui/DataTable.test.tsx` — 5-case vitest suite:
  - renders one `<tr>` per data row
  - `stickyFirstColumn` adds expected class on first `<th>` + `<td>`
  - `mobileRow` slot called per row when provided
  - `renderRow` slot replaces default row rendering
  - empty data → renders `emptyState` (or null)
- [ ] Edit `.claude/rules/responsive-dual-layout-testid-prefixes.md`: add banner at top:
  > ⚠️ Migration in progress (Phase 4): tables on the migrated list use single-DOM `<DataTable>` and drop the `-card-` testid prefix. See `docs/004-notes/ui-reshape-shadcn/scope-todo-202605171244-phase-4.md`. This rule remains load-bearing for unmigrated tables.
- [ ] Verify: `npx eslint .`, `npm run typecheck`, `npm run test --prefix apps/web` all green.

### Commit 2 — `feat(web): migrate AdminProvidersClient to DataTable (Phase 4b)`

- [ ] Refactor `apps/web/components/admin/AdminProvidersClient.tsx` to use `<DataTable>` with `mobileRow` slot (card-stack at `<sm`).
- [ ] Delete the inline `ProviderRow` / `ProviderCard` pair; port card JSX verbatim into `mobileRow` slot.
- [ ] Rename testids: drop `provider-row-card-{id}`, `provider-rerun-btn-card-{id}`, etc.; keep bare `provider-row-{id}` and `provider-rerun-btn-{id}`.
- [ ] Update page-object: `libs/test-e2e/src/pages/admin/AdminProvidersPage.ts` (or equivalent) — delete `-card-` locators.
- [ ] Update `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` — verify both `-row-` and `-card-` locator paths; collapse to `-row-`.
- [ ] Run testid-drift audit grep recipe.
- [ ] Visual QA screenshot capture (mobile + desktop, light + dark) into `docs/004-notes/ui-reshape-shadcn/screenshots/phase-4b/`.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 3 — `feat(web): migrate AdminInstrumentsClient (Phase 4c)`

- [ ] Refactor `AdminInstrumentsClient.tsx` to `<DataTable>` with `stickyFirstColumn` (ticker), scroll-only at `<sm`.
- [ ] Drop `-card-` testid prefix; collapse to `-row-`.
- [ ] Update page-object: `libs/test-e2e/src/pages/admin/AdminInstrumentsPage.ts`.
- [ ] Update affected specs.
- [ ] Run testid-drift audit.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 4 — `feat(web): migrate NhiRollupSection + SourceCompositionTab (Phase 4d)`

- [ ] Refactor `apps/web/features/dividends/components/NhiRollupSection.tsx` to `<DataTable>`, scroll-only.
- [ ] Refactor `apps/web/components/dividends/SourceCompositionTab.tsx` to `<DataTable>`, scroll-only.
- [ ] Drop `sm:hidden` card variants on both.
- [ ] Update page-objects.
- [ ] Run testid-drift audit.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 5 — `feat(web): migrate RecentTransactionsCard (Phase 4e)`

- [ ] Refactor `apps/web/components/dashboard/RecentTransactionsCard.tsx` to `<DataTable>` with `mobileRow` (card-stack at `<sm`).
- [ ] Port existing card JSX into `mobileRow` slot.
- [ ] Drop `-card-` testid prefix.
- [ ] Update dashboard page-object.
- [ ] Visual QA screenshot capture into `screenshots/phase-4e/`.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 6 — `feat(web): migrate CashLedgerClient (Phase 4f)`

- [ ] Refactor `apps/web/features/cash-ledger/components/CashLedgerClient.tsx` to `<DataTable>` with `stickyFirstColumn` (date), scroll-only.
- [ ] Preserve existing pagination interaction (pagination lives outside `<DataTable>`; verify no regression).
- [ ] Drop `-card-` testid prefix.
- [ ] Update page-object.
- [ ] Note: cosmetic `act()` warnings during vitest are pre-existing per `cash-ledger-act-warnings-cosmetic.md` — do not investigate.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 7 — `feat(web): migrate DividendReviewClient (Phase 4g)`

- [ ] Refactor `apps/web/components/dividends/DividendReviewClient.tsx` to `<DataTable>` with `mobileRow` (card-stack at `<sm`) + `stickyFirstColumn` (ticker).
- [ ] Port existing card JSX into `mobileRow` slot.
- [ ] Retire `data-testid="review-card-grid"` (single DOM, no grid wrapper).
- [ ] Drop `-card-` testid prefix.
- [ ] Update page-object: `libs/test-e2e/src/pages/dividends/DividendReviewPage.ts`.
- [ ] Visual QA screenshot capture into `screenshots/phase-4g/`.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 8 — `feat(web): migrate HoldingsTable (Phase 4h)`

- [ ] Refactor `apps/web/components/portfolio/HoldingsTable.tsx` to `<DataTable>` with `stickyFirstColumn` (ticker), scroll-only.
- [ ] Drop `-card-` testid prefix.
- [ ] Update portfolio page-object.
- [ ] If sort/filter ergonomics push the wrapper API → escalate per "tanstack revisit" open item.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 9 — `feat(web): migrate TransactionHistoryTable + renderRow slot (Phase 4i)`

- [ ] Refactor `apps/web/components/portfolio/TransactionHistoryTable.tsx` to `<DataTable>` with `mobileRow` (card-stack at `<sm`) + `stickyFirstColumn` (date) + `renderRow` (for `EditableTransactionRow`).
- [ ] Preserve `EditableTransactionRow.tsx` verbatim; consume via `renderRow` slot when row is in edit mode.
- [ ] Card-stack at `<sm` routes edit flow to existing dialog (no inline edit on mobile).
- [ ] Drop `-card-` testid prefix.
- [ ] Update portfolio page-object.
- [ ] Visual QA screenshot capture into `screenshots/phase-4i/`.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 10 — `test(web): mobile DataTable specs + supersede dual-layout rule (Phase 4j)`

- [ ] Create `apps/web/tests/e2e/specs/mobile-table-transactions-aaa.spec.ts` — card-stack rendering for `TransactionHistoryTable`; row card renders; tap-to-edit opens dialog (not inline).
- [ ] Create `apps/web/tests/e2e/specs/mobile-table-recent-transactions-aaa.spec.ts` — dashboard widget card-stack.
- [ ] Create `apps/web/tests/e2e/specs/mobile-table-providers-aaa.spec.ts` (or `mobile-admin-providers-aaa.spec.ts` under `specs-oauth/`) — admin providers card-stack + rerun button reachable.
- [ ] Create `apps/web/tests/e2e/specs-oauth/mobile-dividend-review-aaa.spec.ts` — review action card-stack.
- [ ] Create `apps/web/tests/e2e/specs/mobile-table-overflow-aaa.spec.ts` — scroll-only guard: loads `HoldingsTable`, `CashLedgerClient`, `AdminInstrumentsClient`, `NhiRollupSection`, `SourceCompositionTab` at `chromium-mobile` viewport; asserts (a) no horizontal page overflow, (b) sticky first column positioned correctly.
- [ ] Edit `.claude/rules/responsive-dual-layout-testid-prefixes.md`: remove banner; mark rule "Superseded by single-DOM `<DataTable>` (Phase 4). Kept as historical reference for the dual-layout pattern."
- [ ] Visual QA sweep for scroll-only tables (commits 3, 4, 6, 8) into `screenshots/phase-4j-scroll-sweep/`.
- [ ] Full 8-suite gate: `npx eslint . --max-warnings=0`, `npm run typecheck`, `npm run test --prefix apps/web`, `npm run test --prefix apps/api`, `npm run test:integration:full:host`, `npm run test:e2e:bypass:mem --prefix apps/web`, `npm run test:e2e:oauth:mem --prefix apps/web`, `npm run test:http --prefix apps/api`.

---

## E2E test phase (per `scope-grill` skill)

- [ ] Run `/aaa` if any of the new mobile specs in commit 10 require fixture/POM scaffolding beyond what's already in place. (Likely yes for the new `mobile-table-*` spec family; reuse Phase 3g's `chromium-mobile`/`chromium-tablet` projects and `AppShellActions.openMobileSidebar()` patterns.)

---

## Open items (carry forward)

- [ ] **Phase 7 cosmetic adoption:** evaluate `FeeProfilesTable`, `AdminAuditLogClient`, `AdminUsersClient`, `AdminInvitesClient`, `OutboundSharesTable`, `AnonymousLinksTable` for `<DataTable>` adoption during Phase 7 cleanup pass (visual consistency, not dual-DOM retirement).
- [ ] **Tanstack revisit:** if commit 7 (DividendReview) or commit 8 (HoldingsTable) hits a wall on sort/filter ergonomics, escalate to consider adopting `@tanstack/react-table` for that table only. Pre-commitment is "no tanstack."
- [ ] **iPhone SE viewport choice (carried from Phase 3g):** still TBD if user-testing surfaces modern small phones (390 × 844 iPhone 14). 1-line config swap in `playwright.config.ts`.

---

## Implementation notes (non-blocking)

1. **`mobileRow` slot:** port existing card JSX **verbatim** from the `lg:hidden` blocks; do not rewrite. Behavior must be byte-for-byte equivalent on mobile.
2. **Column-priority API:** wrapper emits `hidden md:table-cell` / `hidden lg:table-cell` based on `priority` field; thin layer, no headless table logic.
3. **z-index discipline:** sticky cell at `z-1`; shadcn `Popover`/`Tooltip` default `z-50` is unchanged. Dropdowns inside sticky columns must still render above the sticky cell.
4. **Bundle rebuild:** every commit's E2E verification uses `npm run test:e2e:*` (rebuilds standalone); never `npx playwright` direct.
5. **Testid-drift audit per commit:** Code Reviewer runs `playwright-page-object-testid-drift.md` grep recipe on each migration commit's diff.
6. **Visual QA cadence:** per-commit screenshot capture for card-stack commits (2, 5, 7, 9); single sweep at commit 10 for scroll-only tables (3, 4, 6, 8).
7. **Wrapper unit-test seam:** vitest tests structural emission only (jsdom does not honor breakpoints). Real responsive behavior validated by Playwright in commit 10. Documented in `DataTable.tsx` file header.
8. **`review-card-grid` testid retirement:** noted in commit 7 page-object update.
9. **`provider-health-aaa.spec.ts` review:** lockstep in commit 2.
10. **Waiver track:** `waiver:linear-ticket` label + `## Waiver` section on the final PR; commits use `ui-enhancement` track per `commit-format.md`. Format: `feat(web): subject\n\nPhase 4X — short context.`
11. **No new i18n keys.** Wrapper renders no text; `emptyState` is consumer-provided.
12. **`--row-h` density variable:** wrapper class/style hook from Phase 2's density token.
13. **Suite 8 (HTTP):** retained in commit 10 verification gate as defensive; Phase 4 has no API changes.

---

## References

- Parent scope-todo: [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md) (Phase 4 line items superseded by this file)
- Locked design: [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md) — §9 retire-dual-DOM and §11 testid contracts
- Phase 3 addendum (for cross-reference on testid + page-object discipline): [`scope-todo-202605161858-phase-3-addendum.md`](./scope-todo-202605161858-phase-3-addendum.md)
- Project rules consulted:
  - `.claude/rules/responsive-dual-layout-testid-prefixes.md` — to-be-superseded
  - `.claude/rules/playwright-page-object-testid-drift.md` — audit recipe per commit
  - `.claude/rules/playwright-web-bundle-rebuild.md` — rebuild discipline
  - `.claude/rules/cash-ledger-act-warnings-cosmetic.md` — pre-existing warnings, skip
  - `.claude/rules/phased-ticket-scope-completeness.md` — config→render glue check
- Linear tickets: none (waiver track)
