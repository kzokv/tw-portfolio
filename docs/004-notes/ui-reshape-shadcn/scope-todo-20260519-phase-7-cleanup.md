---
slug: ui-reshape-phase-7-cleanup
source: scope-grill
created: 2026-05-19
tickets: []
required_reading:
  - docs/004-notes/ui-reshape-shadcn/design-202605151200-locked-scope.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md
  - docs/004-notes/ui-reshape-shadcn/phase-3-spec-202605161110-shell-decomp.md
  - docs/004-notes/ui-reshape-shadcn/decisions-202605151245-audit-resolutions.md
  - .claude/rules/playwright-page-object-testid-drift.md
  - .claude/rules/playwright-web-bundle-rebuild.md
superseded_by: null
---

# Todo: Phase 7 — Legacy UI cleanup

> **For agents starting a fresh session:** read all files listed in `required_reading` before starting implementation. This todo supersedes the Phase 7 line items in `scope-todo-202605151201-phases.md` where they imply a deletion-only, one-commit cleanup.

Waiver track per `commit-format.md` (`ui-enhancement`; no Linear ticket; PR carries `waiver:linear-ticket` label with `## Waiver` section).

---

## Locked Scope Decisions

1. Phase 7 is **7a convergence + 7b deletion gate**, not deletion-only.
2. Adapter shim deletion is **conditional**. Remove legacy styling/import blockers; defer full shim deletion unless consumer count reaches zero naturally.
3. Scope is **token convergence only**. No cosmetic DataTable adoption, no new settings routes, no product expansion.
4. Alias/glass deletion requires **hard zero-consumer grep gates**.
5. Verification is **frontend-focused + targeted visual/E2E smoke**, with full eight-suite gate only if behavioral/API/auth/persistence surfaces change.
6. Delivery is **2 commits**.
7. `FloatingStatsBubble` is **kept and modernized**, not deleted.
8. The parent Phase 7 section and this detailed todo are both source-of-truth handoffs.

---

## Phase 7a — Converge legacy consumers

Commit: `refactor(web): converge legacy UI tokens (Phase 7a)`

- [x] Run the baseline live-consumer audit:
  ```sh
  rg -n "\\b(glass-panel|glass-inset|surface-glass|bg-sheen|shadow-glass|bg-bg|text-ink\\b|text-ink-muted\\b|border-line\\b|text-danger\\b|bg-surface\\b|bg-surface-soft\\b|bg-surface-glass\\b|font-display\\b)" apps/web --glob '!**/.next/**'
  ```
- [x] Replace every app-side `glass-panel`, `glass-inset`, and `shadow-glass` consumer with shadcn-token surfaces (`bg-card`, `border border-border`, `shadow-sm`/`shadow-md` only where appropriate, `text-foreground`, `text-muted-foreground`).
- [x] Replace every legacy token alias consumer:
  - `bg-bg` -> `bg-background`
  - `text-ink` -> `text-foreground`
  - `text-ink-muted` -> `text-muted-foreground`
  - `bg-surface` / `bg-surface-soft` / `bg-surface-glass` -> `bg-card`, `bg-muted`, or `bg-background` based on surrounding intent
  - `border-line` -> `border-border`
  - `text-danger` -> `text-destructive`
- [x] Replace every `font-display` usage with the standard Geist-backed typography classes already provided by `globals.css` and Tailwind `fontFamily.display`.
- [x] Reskin `apps/web/features/settings/components/ProfileSection.tsx` to remove legacy slate-only styling while preserving existing testids and behavior.
- [x] Reskin `apps/web/features/settings/components/MonitoredTickersSection.tsx` to remove legacy slate-only styling while preserving explicit batch-save behavior (`tickers-save-btn`) and existing testids.
- [x] Reskin `apps/web/features/settings/components/AccountCreateForm.tsx` to remove `glass-inset`, `text-ink`, and slate-only styling.
- [x] Modernize legacy dialog surfaces that still use `glass-panel`/`shadow-glass`:
  - `apps/web/components/fx-transfer/RecordFxTransferDialog.tsx`
  - `apps/web/features/dashboard/components/IntegrityIssueDialog.tsx`
  - `apps/web/components/portfolio/FeeRecalcConfirmDialog.tsx`
  - `apps/web/components/portfolio/RecordTransactionDialog.tsx`
  - `apps/web/components/portfolio/DeleteConfirmationDialog.tsx`
  - `apps/web/components/portfolio/EditConfirmationDialog.tsx`
  - `apps/web/features/settings/components/RepairModal.tsx`
  - `apps/web/components/sharing/GrantShareDialog.tsx`
  - `apps/web/components/sharing/CreateAnonymousLinkDialog.tsx`
- [x] Modernize skeleton/card legacy surfaces:
  - `apps/web/components/dashboard/HeroSkeleton.tsx`
  - `apps/web/components/dashboard/DashboardLoading.tsx`
  - `apps/web/components/layout/SectionHeroPanels.tsx`
  - `apps/web/components/portfolio/RecomputeCard.tsx`
  - `apps/web/components/portfolio/HoldingsTable.tsx`
  - `apps/web/components/portfolio/FeeProfilesTable.tsx`
- [x] Keep `apps/web/components/ui/FloatingStatsBubble.tsx`; modernize it and `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx` only enough to remove legacy styling from the ticker detail section and sticky bubble.
- [x] Remove legacy styling from adapter shims that remain in use:
  - `apps/web/components/ui/Button.tsx`
  - `apps/web/components/ui/Card.tsx`
  - `apps/web/components/ui/Drawer.tsx`
  - `apps/web/components/ui/TooltipInfo.tsx`
- [x] Audit shim imports:
  ```sh
  for f in Button Card Drawer Popover Tabs TooltipInfo; do rg -n "from ['\\\"].*/components/ui/$f|from ['\\\"]@/components/ui/$f" apps/web libs; done
  ```
- [x] Delete a shim only if its import count is zero after natural migration. Otherwise leave it tokenized and add a follow-up note in this todo's Open Items before finishing.
- [x] Run convergence verification:
  ```sh
  npx eslint .
  npm run typecheck
  npm run test --prefix apps/web
  npm run build -w @vakwen/web
  ```

---

## Phase 7b — Delete bridge behind gates

Commit: `refactor(web): remove legacy UI bridge (Phase 7b)`

- [x] Confirm these grep gates return zero live app consumers before deletion:
  ```sh
  rg -n "glass-panel|glass-inset|shadow-glass|surface-glass|bg-sheen" apps/web --glob '!**/.next/**'
  rg -n "bg-bg|text-ink\\b|text-ink-muted\\b|bg-surface|bg-surface-soft|bg-surface-glass|border-line|text-danger" apps/web --glob '!**/.next/**'
  rg -n "font-display" apps/web --glob '!**/.next/**'
  ```
- [x] Delete the legacy alias bridge block from `apps/web/app/globals.css`.
- [x] Delete `.glass-panel`, `.glass-panel::after`, and `.glass-inset` CSS blocks from `apps/web/app/globals.css`.
- [x] Delete legacy Tailwind aliases from `apps/web/tailwind.config.mjs`: `bg`, `surface`, `surface-soft`, `surface-glass`, `ink`, `ink-muted`, `accent-strong`, `line`, `danger`, and `shadow.glass` if no consumers remain.
- [x] Update `.claude/rules/` entries that reference retired glass/alias patterns. Keep historical references only when explicitly marked as superseded. No active `.claude/rules/` entries referenced the retired patterns.
- [x] Update docs that would otherwise mislead future agents into using retired classes or deleting `FloatingStatsBubble`.
- [x] Re-run the grep gates and save the command outputs in the implementation summary.

---

## Targeted Visual/E2E Smoke

- [x] Verify affected routes/components in light and dark:
  - Dashboard loading/skeleton states
  - Dashboard integrity dialog/alert path
  - Portfolio recompute card and transaction/edit/delete/fee dialogs
  - FX transfer dialog
  - Settings profile
  - Settings tickers
  - Settings account create/repair surfaces
  - Sharing grant/create-link dialogs
  - Ticker detail page with `FloatingStatsBubble`
  - Login, invite, auth error, and public share not-found pages if `font-display`/`bg-bg` changes touch them
- [x] Use targeted Playwright or browser smoke for the changed surfaces. Capture screenshots for the routes where `glass-panel` / `glass-inset` was removed.
- [x] Run the full eight-suite gate only if implementation touches API, auth, persistence, shared types, or broad E2E page objects. Not triggered: no API, auth contract, persistence, shared-type, or broad page-object changes.

---

## Out Of Scope

- [x] Do not add `/settings/notifications` or `/settings/privacy` routes.
- [x] Do not do cosmetic `<DataTable>` adoption for already single-DOM tables.
- [x] Do not redesign the ticker-detail page beyond tokenizing the existing sticky stats affordance.
- [x] Do not force full adapter-shim deletion if consumers remain.
- [x] Do not introduce new product behavior or persistence changes.

---

## Implementation Evidence

- Zero-consumer grep gates passed for legacy glass classes, legacy token aliases, `font-display`, and bridge definitions.
- Shim import audit found live adapter consumers for `Button`, `Card`, `Drawer`, and `TooltipInfo`; `Popover` and `Tabs` had zero app/libs imports. No adapter shim was deleted in this phase.
- Validation passed: targeted Vitest (`Card`, `Drawer`, `AccountCreateForm`), full `apps/web` Vitest, `npx eslint .`, `npm run typecheck`, and `npm run build -w @vakwen/web`.
- Targeted Playwright smoke passed: `settings persist across routes and reloads for the same seeded user`, `[hero-A] DashboardHero renders total + day Delta above the grid`, and `transaction mutations / navigate to symbol page from portfolio holdings link`.
- Browser screenshots captured in light and dark for dashboard, settings profile, settings tickers, portfolio, ticker detail, login, auth error, and public share not-found routes.

---

## Open Items

- [ ] Follow-up cleanup: delete adapter shims in `apps/web/components/ui/{Button,Card,Drawer,Popover,Tabs,TooltipInfo}.tsx` once all consumers import shadcn primitives directly.
- [ ] Follow-up cosmetic adoption from Phase 4 remains separate: evaluate `FeeProfilesTable`, `AdminAuditLogClient`, `AdminUsersClient`, `AdminInvitesClient`, `OutboundSharesTable`, `AnonymousLinksTable` for `<DataTable>` only if a later polish phase explicitly scopes it.

---

## References

- Parent scope-todo: [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md)
- Locked design: [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md)
- Phase 3 spec, Phase 7 prereq: [`phase-3-spec-202605161110-shell-decomp.md`](./phase-3-spec-202605161110-shell-decomp.md)
- FloatingStatsBubble decision: [`decisions-202605151245-audit-resolutions.md`](./decisions-202605151245-audit-resolutions.md)
- Linear tickets: none (waiver track)
