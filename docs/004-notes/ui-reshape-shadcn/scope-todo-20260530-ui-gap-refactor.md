---
slug: ui-gap-refactor
source: scope-grill
created: 2026-05-30
tickets: []
required_reading:
  - docs/004-notes/ui-reshape-shadcn/README.md
  - docs/004-notes/ui-reshape-shadcn/design-202605151200-locked-scope.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md
  - docs/004-notes/ui-reshape-shadcn/phase-3-spec-202605161110-shell-decomp.md
  - docs/004-notes/ui-reshape-shadcn/decisions-202605151245-audit-resolutions.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-20260519-phase-7-cleanup.md
  - docs/004-notes/ui-reshape-shadcn/screenshots
superseded_by: null
---

# Todo: UI Gap Refactor After Shadcn Reshape

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This scope was locked after a Chrome walkthrough of the hosted dev UI against `docs/004-notes/ui-reshape-shadcn/screenshots`.

## Locked Scope Decisions

- [ ] Use a hybrid baseline: original numbered screenshots (`01-40`) define design intent for data-first, auth/public, and admin pages; current `phase7`/shadcn direction defines shell, settings, ticker detail, and newer AI surfaces.
- [ ] Restore density by task type. Data-first pages should be table/workflow-first; dashboard and settings may retain more breathing room.
- [ ] Demote large current hero/summary blocks on data-first pages into compact metric strips or secondary context.
- [ ] Include route-transition UX feedback plus shallow performance triage. Investigate React hydration error `#418`.
- [ ] Scope admin to a real overview route plus obvious defects only.
- [ ] Redesign Admin Settings from horizontal tabs to a vertical section nav inside the existing `/admin/settings?tab=...` page. Match the user settings two-pane interaction model without splitting admin settings into new routes.
- [ ] Bring auth/public pages closer to the original mockups, except valid invite parity may depend on fixture availability.
- [ ] Keep current settings layout and fix obvious UX defects only.
- [ ] Keep current ticker detail direction and fix edge states only.
- [ ] Treat mobile as first-class scope, deriving responsive behavior from desktop intent; verify light and dark on desktop and mobile.
- [ ] Polish AI surfaces for consistency only; do not add MCP/product behavior.
- [ ] Use screenshot checklist acceptance, not pixel-perfect diffs.

## Implementation Steps

- [ ] Create a route baseline matrix mapping each page to its target baseline:
  - `01-40` design intent: portfolio, transactions, cash ledger, dividends, sharing, admin pages, login, auth error, public share not-found, invite shell.
  - `phase7/current` direction: app shell, topbar, sidebar, settings, ticker detail, AI Inbox, AI Connectors.
- [ ] Capture current desktop/mobile light/dark screenshots before changing UI, using the hosted dev target or an equivalent seeded environment.
- [x] Add route-transition feedback in the shell:
  - show immediate pending destination state after sidebar/topbar navigation;
  - avoid leaving users on stale previous-page content with no feedback;
  - keep feedback unobtrusive and compatible with current shadcn shell.
- [ ] Run shallow performance triage for slow routes:
  - measure route settle times for dashboard, portfolio, transactions, cash ledger, dividends, ticker detail, settings accounts;
  - separate server/API time, Next rendering, client hydration, and network/tunnel effects where practical;
  - fix straightforward issues only, otherwise record follow-up findings.
- [ ] Enforce the warm-navigation UX exit criteria:
  - meaningful route-specific content within 3 seconds, or route-specific loading/partial state by 3 seconds;
  - visible navigation feedback within 300 ms;
  - no stale previous-page content left unchanged for more than 500 ms after navigation starts;
  - cold starts, deploy wakeups, Cloudflare/tunnel outages, and first load after cache eviction are recorded separately and do not fail this UI scope;
  - direct URL loads are measured, but in-app navigation is the primary UX criterion.
- [x] Investigate React hydration error `#418`; fix if the cause is local and straightforward, otherwise document a separate follow-up.
- [x] Refactor portfolio toward table-first workflow:
  - move holdings table and filters higher;
  - reduce duplicated "Holdings Focus" hero/summary sections;
  - keep useful compact metrics in a slim strip;
  - remove prominent raw/internal account IDs from first-viewport UI.
- [x] Refactor transactions toward table-first workflow:
  - make Posted/AI Inbox tabs and transaction table the primary surface;
  - move record form into secondary placement such as a sheet/dialog or lower panel;
  - keep AI Inbox discoverable without dominating product behavior.
- [x] Refactor cash ledger toward original dense intent:
  - add/restore a clear page heading;
  - keep compact balance cards and running ledger table first;
  - improve filter scanability without introducing new ledger behavior.
- [x] Refactor dividends toward review/table/NHI-first behavior when review items exist:
  - keep calendar as a tab or secondary mode;
  - preserve current review and NHI product behavior;
  - avoid calendar-first empty-state dominance when actionable dividend review data exists.
- [x] Tighten sharing page spacing while preserving current product states and actions.
- [x] Restore or add an admin overview route for `/admin` if admin landing is expected.
- [x] Fix obvious admin defects:
  - replace admin settings horizontal tabs with a vertical desktop section nav plus mobile select/dropdown;
  - keep admin settings as one `/admin/settings?tab=<slug>` page, not a new route family;
  - preserve existing admin settings testids where practical: `admin-settings-tabs`, `admin-settings-tab-{slug}`, `admin-settings-panel-{slug}`;
  - table readability/spacing on users, instruments, providers, and audit log where visibly weak;
  - keep current admin shell/sidebar.
- [x] Bring login, auth error, and public share not-found closer to AuthShell mockups:
  - brand mark/card hierarchy;
  - correct CTA hierarchy;
  - theme control where appropriate;
  - terms/privacy footer where appropriate.
- [x] Polish invite shell and signed-in/invalid invite states; do not block on valid invite parity unless a valid invite fixture is easy to generate.
- [x] Keep settings layout and fix obvious UX defects:
  - Display validation timing and disabled save affordance;
  - confusing empty-state messaging;
  - spacing or text clipping if encountered.
- [x] Keep ticker detail direction and fix edge states:
  - no-holdings/empty-state label truncation;
  - responsive floating summary/card behavior;
  - no overlap with content on desktop or mobile.
- [x] Polish AI surfaces only for consistency:
  - AI Inbox states follow the denser transactions layout;
  - AI Connectors spacing/headings/toggles fit current settings layout;
  - no MCP, auth, permission, or connector behavior changes.
- [ ] Verify responsive behavior as first-class scope:
  - desktop light/dark;
  - mobile light/dark;
  - no text overlap, clipped labels, unreachable actions, or unintended horizontal overflow outside table scroll areas.
- [ ] Capture final screenshots for every touched route and compare against the chosen baseline with explicit ignore rules.
- [x] Update this todo by ticking off completed deliverables and recording any follow-up items not implemented.

## Acceptance Rules

- [ ] Passes when hierarchy, first-viewport priority, density, spacing, and key controls match the agreed route-specific intent.
- [ ] Ignore live data differences, timestamps, counts, account names, chart data, and exact pixel differences.
- [ ] Fail on overlapping text, clipped labels, unreachable controls, confusing blank/loading states, stale-page navigation waits, or raw/internal IDs in prominent user-facing UI.
- [ ] Warm in-app navigation fails if it misses the 3s content/partial-state threshold, the 300ms feedback threshold, or the 500ms stale-content threshold.
- [ ] Do not declare full test completion unless all eight project suites pass; for this scope, targeted visual and relevant web checks are expected unless implementation touches broader contracts.

## Out Of Scope

- [ ] No new MCP, connector, auth, permission, persistence, or API behavior.
- [ ] No full pixel-perfect recreation of every `01-40` screenshot.
- [ ] No deep performance optimization unless shallow triage finds an obvious local fix.
- [ ] No full old ticker chart/fundamentals redesign in this pass.
- [ ] No full admin subpage parity beyond admin overview and obvious defects.
- [ ] No admin settings route-family split such as `/admin/settings/rate-limits`; keep URL query-driven sections.
- [ ] No valid invite/public-share parity if fixtures are not readily available.

## Open Items

- [ ] Valid invite parity may require a generated invite code or fixture.
- [ ] Valid public share parity may require an active public share token or fixture.
- [ ] Hydration error `#418` still needs a separate bug / follow-up unless a later pass isolates a straightforward local fix.
- [ ] Deep performance work should become a separate ticket if shallow triage shows backend/server bottlenecks.

### 2026-05-30 progress notes

- Shell warm-navigation feedback now appears immediately for sidebar/topbar quick-search/command-palette navigations, and stale content is visibly dimmed until the destination settles.
- Added route-specific loading surfaces for `/portfolio`, `/transactions`, `/tickers/[ticker]`, and `/settings` to avoid reusing the dashboard loading state for unrelated routes.
- Admin now lands on a real overview route at `/admin`, and `/admin/settings` keeps the query-driven `?tab=...` contract while switching to a vertical desktop nav plus mobile select/dropdown.
- Portfolio, transactions, cash ledger, dividends, sharing, ticker detail, AI surfaces, and auth/public shells were reshaped toward the locked density and hierarchy targets in this slice.
- Final validation also included the sortable-grid pointer collision fix for tall transaction cards so drag/reorder affordances no longer steal pointer intent from adjacent card content.
- Hydration error `#418` was not isolated to a straightforward shell-local fix in this slice; it remains follow-up work.

## Final Implementation And Validation

- [x] Implementation completed for the documented UI slice: shell navigation feedback and stale-content dimming, route-specific loading states, table-first data workflows, admin overview, admin settings vertical desktop nav + mobile select, retained `/admin/settings?tab=...` URL state, auth/public shell refresh, and targeted settings/ticker/AI consistency polish.
- [x] Warm-navigation UX implementation now targets the locked criteria: visible feedback within 300 ms, stale previous content dimmed during navigation, and route-specific loading or partial content by 3 seconds for the touched routes.
- [ ] Shallow performance triage and deep performance follow-up are still open; no separate performance sign-off is recorded in this note.
- [ ] Hydration error `#418` remains follow-up; this pass did not prove a straightforward local fix.
- [x] Current-tree validation gates passed:
  - `npx eslint .`
  - `npm run typecheck`
  - `npm run test --prefix apps/web` — 64 files, 433 tests passed
  - `npm run test --prefix apps/api` — 125 files, 1350 tests passed; 40 files / 407 tests skipped
  - `npm run test:e2e:bypass:mem --prefix apps/web` — 255 passed, 10 skipped
  - `npm run test:e2e:oauth:mem --prefix apps/web` — 129 passed
  - `npm run test:http --prefix apps/api` — 273 passed, 2 skipped
- [x] `npm run test:integration:full:host` passed earlier in this implementation run as the Postgres-backed integration gate: 78 files, 750 tests passed, 1 skipped. It was not rerun after later web-only changes.

## References

- Original and phase7 screenshots: `docs/004-notes/ui-reshape-shadcn/screenshots`
- Phase 7 cleanup scope: `docs/004-notes/ui-reshape-shadcn/scope-todo-20260519-phase-7-cleanup.md`
- App shell spec: `docs/004-notes/ui-reshape-shadcn/phase-3-spec-202605161110-shell-decomp.md`
