---
slug: admin-ui-bugs
source: scope-grill
created: 2026-05-12
tickets: []
required_reading:
  - docs/004-notes/admin-ui-bugs/scope-todo-202605120208-locked.md
superseded_by: null
---

# Todo: admin-ui-bugs

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Worktree: `.claude/worktrees/admin-ui-bugs` (branch `worktree-admin-ui-bugs`, based on dev @ 6ad4906). Screenshots of the original failure: `.worklog/admin-providers.png`, `.worklog/admin-settings.png`.

## Scope summary

Two unrelated admin-page bugs landing in one PR:

- **Bug 1 — `/admin/providers` table layout.** Provider name column truncates the `?` tooltip icon (swallowing help). `Last Success` / `Last Failed` columns visually collide because their `whitespace-nowrap` content overflows the equal-width `table-fixed` cells.
- **Bug 2 — `/admin/settings` tabbed layout.** `Dashboard Timeframe Defaults` and `Provider API keys` cards render outside the `<TabsRoot>` (sibling at the same DOM level), so they show under every tab.

Decisions locked in scope-grill 2026-05-12:

- Reverse the KZO-199 "outside-tabs is correct" framing — move both orphan cards into their own new tabs.
- Two separate tabs, slugs `display-defaults` and `api-keys`, appended at end of `TAB_SLUGS` → 7 tabs total.
- Replace the hover-tooltip `?` icon in the providers table with a **click-popover on the provider name itself**. Add `@radix-ui/react-popover` to deps.
- Convert the providers table to the wrap convention: drop `truncate` + `whitespace-nowrap`; use `<colgroup>` widths sized to content; let locale timestamps wrap naturally on the comma-space.
- Patterns P1–P5 from this session were promoted to KZO-206's description so the wrap-convention rule (to be written under KZO-206) captures them.

## Implementation Steps

### Bug 2 — `/admin/settings` tabs

- [x] Extend `TAB_SLUGS` in `apps/web/components/admin/AdminSettingsClient.tsx:27` with `"display-defaults"` and `"api-keys"` (appended).
- [x] Extend `TAB_LABELS` in the same file with `"display-defaults": "Display defaults"` and `"api-keys": "API keys"`.
- [x] Move the `Dashboard Timeframe Defaults` `<Card>` (currently at line 685, outside `<TabsRoot>`) inside a new `<TabsContent value="display-defaults" data-testid="admin-settings-panel-display-defaults">`. Existing `data-testid="timeframe-defaults-section"` stays.
- [x] Move the `Provider API keys` `<Card>` (currently at line 828, outside `<TabsRoot>`) inside a new `<TabsContent value="api-keys" data-testid="admin-settings-panel-api-keys">`. Existing `data-testid="admin-settings-provider-keys-section"` stays.
- [x] Verify the existing comment at `AdminSettingsClient.tsx:301-303` is removed / updated — it claims the cards are intentionally outside the tabs (KZO-199 framing). That comment is now stale.
- [x] Update `libs/test-e2e/src/assistants/layout/AppShellAssert.ts:365-396` — add a private `ensureDisplayDefaultsTabActive()` (clicks `admin-settings-tab-display-defaults`, idempotent), and call it at the top of `adminTimeframeSectionIsVisible`, `adminTimeframeChipIsActive`, `adminTimeframeChipIsInactive`, `adminTimeframeChipIsAbsent`, `adminTimeframeChipsInOrder`, plus any other helper that reads through `timeframe-defaults-section` scope.
- [x] Update `apps/web/tests/e2e/specs-oauth/admin-settings-tier-a-aaa.spec.ts:207-208` — add `await appShell.actions.navigateToAdminSettingsTab("api-keys")` between `adminSettingsPageIsVisible()` and the `${prefix}-mask` waitFor. Apply to every test in that file that touches `admin-settings-finmind-api-token-*` or `admin-settings-twelve-data-api-key-*` testids.
- [x] Update `apps/web/tests/e2e/specs-oauth/admin-settings-tier-b-aaa.spec.ts:132-138` — extend the slug-loop array to include `display-defaults` and `api-keys`.
- [x] Verify `apps/web/test/components/admin/AdminSettingsClient-timeframes.test.tsx:93` (unit test using `document.querySelector("[data-testid='timeframe-defaults-section']")`) still passes — Tabs primitive uses `forceMount` (`apps/web/components/ui/Tabs.tsx:62`) so the section is in the DOM regardless of active tab.

### Bug 1 — `/admin/providers` table layout

- [x] Add `"@radix-ui/react-popover": "^1.x"` to `apps/web/package.json` and run `npm install`.
- [x] Create `apps/web/components/ui/Popover.tsx` shim — mirror the `TooltipInfo` pattern (export `PopoverRoot`, `PopoverTrigger`, `PopoverContent`; testids stamped by caller). `forceMount` is NOT desired here (popovers are mounted on open).
- [x] In `apps/web/components/admin/AdminProvidersClient.tsx`:
  - [x] Add `<colgroup>` after `<table>` opening tag with widths: provider 140, status 110, last-success 130, last-failed 130, errors24h 70, errors7d 70, rate24h 70, actions 150 (total ~870px).
  - [x] **Provider name cell (table, line 248-261):** drop the `truncate` class on the `<td>`. Replace the inner `<span class="inline-flex items-center gap-1.5">{id}{TooltipInfo}</span>` with a Popover trigger button: `<PopoverRoot><PopoverTrigger asChild><button data-testid={\`provider-help-trigger-${id}\`} className="text-left break-all hover:text-indigo-700 cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded">{id}</button></PopoverTrigger><PopoverContent data-testid={\`provider-help-popover-${id}\`}>{resolveRerunTooltipContent(localStatus)}</PopoverContent></PopoverRoot>`. Keep `title={id}` on the surrounding wrapper as a screen-reader fallback.
  - [x] **Provider name cell (card, line 348-358):** drop the `truncate` class on the wrapping `<p>` (line 347) and on the inner `<span class="truncate">` (line 351). Replace the inner span + `TooltipInfo` with the same Popover pattern using `-card-` testid suffix per `.claude/rules/responsive-dual-layout-testid-prefixes.md`: `provider-help-trigger-card-${id}` / `provider-help-popover-card-${id}`.
  - [x] **Timestamp cells (table, lines 266 and 272):** drop the `whitespace-nowrap` class. Default wrap will split on the comma-space in `5/12/2026, 9:34:23 AM`. Keep the `title={...lastSuccessfulRun ?? ""}` attribute as raw-ISO fallback.
  - [x] Update inline comments — the KZO-199 `truncate + title` rationale at lines 244-247 + 340-343 + 416-417 is now misleading. Reword to reference the wrap convention.
- [x] Update `apps/web/test/components/admin/AdminProvidersClient.test.tsx`: change `provider-rerun-tooltip-trigger-${id}` → `provider-help-trigger-${id}` at line 156, `provider-rerun-tooltip-trigger-card-${id}` → `provider-help-trigger-card-${id}` at line 160, `provider-rerun-tooltip-trigger-yahoo-finance-au` → `provider-help-trigger-yahoo-finance-au` at line 175.
- [x] Update `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts`: change `provider-rerun-tooltip-trigger-${id}` → `provider-help-trigger-${id}` at line 344; `provider-rerun-tooltip-trigger-yahoo-finance-au` → `provider-help-trigger-yahoo-finance-au` at line 362; `provider-rerun-tooltip-content-yahoo-finance-au` → `provider-help-popover-yahoo-finance-au` at line 366. The hover-to-show interaction model changes — review whether the spec needs `.click()` instead of `.hover()` for the popover.
- [x] Run `/aaa` to add/update E2E tests covering the new popover interaction (click-to-show, outside-click dismiss, Escape dismiss) and the new tab-click flow for `display-defaults` and `api-keys`. Apply per `.claude/rules/responsive-dual-layout-testid-prefixes.md` (both `-card-` and table variants).

### Cross-cutting

- [x] Visual verification via Chrome DevTools MCP against the running E2E webServer (NOT a fresh `npm run dev` — see `.claude/rules/validator-process-hygiene.md`): at viewport 1280px with sidebar open, confirm (a) no horizontal scrollbar on `/admin/providers`; (b) provider names wrap on hyphens; (c) timestamps wrap on the comma-space; (d) clicking a provider name opens a popover, clicking elsewhere closes it; (e) `/admin/settings` shows tabs `display-defaults` and `api-keys` with the moved cards inside; (f) all 7 tab triggers visible and scrollable on narrow viewports.
- [x] Pre-PR test suite gate per `.claude/rules/full-test-suite.md`: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`.
- [x] Pre-PR rebuild of `libs/*/dist` if cross-package types changed (per `.claude/rules/full-test-suite.md` § "Stale `dist/` drift").
- [x] PR body MUST follow `docs/git-pr-flow.md §3-4` per `.claude/rules/pr-bound-docs-review-compliance.md`: `## Problem`, `## Solution`, `## Testing` with concrete `Evidence:` block (suite counts), `## Risk/Rollback`. CI `pr-gate.yml` enforces these section headings.
- [x] Commit messages follow `type(scope): subject` (NO `KZO-XX:` segment). **Resolution:** user chose option (c) — waiver mode. Commits + PR title omit the ticket prefix; PR body's `## Waiver` section + `waiver:linear-ticket` label satisfy `pr-gate.yml`. See `.claude/rules/commit-format.md` § "Per-PR waiver" for the canonical schema (added by this PR's /si:promote pass).

## Open Items

(None — gap check clean at scope lock.)

## References

- Reference screenshots: `.worklog/admin-providers.png`, `.worklog/admin-settings.png`
- Linear ticket updated with patterns P1–P5: [KZO-206](https://linear.app/kzokv/issue/KZO-206/responsive-text-wrap-convention-across-admin-portfolio-pages)
- Source files in scope:
  - `apps/web/components/admin/AdminProvidersClient.tsx`
  - `apps/web/components/admin/AdminSettingsClient.tsx`
  - `apps/web/components/ui/Popover.tsx` (NEW)
  - `apps/web/package.json` (add `@radix-ui/react-popover`)
- Test files in scope:
  - `apps/web/test/components/admin/AdminProvidersClient.test.tsx`
  - `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts`
  - `apps/web/tests/e2e/specs-oauth/admin-settings-tier-a-aaa.spec.ts`
  - `apps/web/tests/e2e/specs-oauth/admin-settings-tier-b-aaa.spec.ts`
- Page-object updates:
  - `libs/test-e2e/src/assistants/layout/AppShellAssert.ts`
- Locked testids:

  | Surface | Table testid | Card testid |
  |---|---|---|
  | Popover trigger | `provider-help-trigger-{id}` | `provider-help-trigger-card-{id}` |
  | Popover content | `provider-help-popover-{id}` | `provider-help-popover-card-{id}` |
  | Tab trigger (settings) | `admin-settings-tab-display-defaults`, `admin-settings-tab-api-keys` | — |
  | Tab panel (settings) | `admin-settings-panel-display-defaults`, `admin-settings-panel-api-keys` | — |
  | Preserved (relocated) | `timeframe-defaults-section`, `admin-settings-provider-keys-section` | — |
  | Removed | `provider-rerun-tooltip-trigger-{id}`, `provider-rerun-tooltip-content-{id}` (+ `-card-` variants) | — |

## Linked work (separate ticket)

- **KZO-206** — responsive wrap convention across admin + portfolio pages. Description updated 2026-05-12 with patterns P1–P5 surfaced by this session. This admin-ui-bugs PR is the canonical reference PR for KZO-206's eventual rule-authoring step.
