---
slug: admin-ui-bugs
type: transition
created: 2026-05-12T14:00:00Z
team: admin-ui-bugs
branch: worktree-admin-ui-bugs
base: dev @ 6ad4906
tickets: []
linked_work: KZO-206
status: frozen
---

# Transition Note — Admin Providers Popover + Settings Tab Cards

> **Frozen snapshot** — do not update after merge. Pre-merge corrections are allowed per `doc-management.md`. Post-merge: create a new note.

## Summary

This PR resolves two unrelated admin-page layout bugs in a single diff:

1. **`/admin/providers` table layout** — provider-name tooltip clipped by `truncate`; locale timestamps overflow their cells due to `whitespace-nowrap`. Fixed by converting to the wrap convention (drop `truncate` + `whitespace-nowrap`; add `<colgroup>` explicit widths) and replacing the hover-tooltip `?` icon with a click-popover anchored to the provider name itself.
2. **`/admin/settings` orphan cards** — `Dashboard Timeframe Defaults` and `Provider API keys` cards rendered as siblings of `<TabsRoot>`, visible under every tab. Fixed by moving each into its own dedicated new tab.

The KZO-199 "outside-tabs is correct" framing was reversed. The KZO-199 `truncate + title as SR fallback` heuristic was superseded by the wrap convention.

---

## Changed Files (component by component)

### New file: `apps/web/components/ui/Popover.tsx`

First adoption of `@radix-ui/react-popover` in this repo. The shim mirrors the `TooltipInfo` pattern:
- Exports: `PopoverRoot`, `PopoverTrigger`, `PopoverContent`
- Testids stamped by callers (not the shim) — follows same discipline as `TooltipInfo`
- `forceMount` NOT applied — popovers mount-on-open (correct default; contrast with `Tabs.tsx:62` which uses `forceMount`)

### `apps/web/package.json`

Added `"@radix-ui/react-popover": "^1.x"`. Lockfile updated.

### `apps/web/components/admin/AdminProvidersClient.tsx`

| Location | Change |
|---|---|
| After `<table>` opening tag | Added `<colgroup>` with column widths: provider 140px, status 110px, last-success 130px, last-failed 130px, errors24h 70px, errors7d 70px, rate24h 70px, actions 150px (~870px total) |
| Provider name cell — table (~line 248-261) | Dropped `truncate` class. Replaced `<span>{id}<TooltipInfo /></span>` with `<PopoverRoot><PopoverTrigger asChild><button data-testid="provider-help-trigger-{id}" className="text-left break-all hover:text-indigo-700 cursor-help ...">` |
| Provider name cell — card (~line 348-358) | Dropped `truncate` on wrapping `<p>` and inner `<span>`. Applied same Popover pattern with `-card-` testid suffix |
| Timestamp cells (~lines 266, 272) | Dropped `whitespace-nowrap`. `title={...lastSuccessfulRun}` raw-ISO fallback preserved |
| Inline comments (~lines 244-247, 340-343, 416-417) | Rewrote KZO-199 `truncate + title` rationale to reference the wrap convention |

### `apps/web/components/admin/AdminSettingsClient.tsx`

| Location | Change |
|---|---|
| `TAB_SLUGS` (line 27) | Appended `"display-defaults"` and `"api-keys"` — 5 → 7 tabs total |
| `TAB_LABELS` | Added `"display-defaults": "Display defaults"` and `"api-keys": "API keys"` |
| `Dashboard Timeframe Defaults` card (~line 685) | Moved from outside `<TabsRoot>` into new `<TabsContent value="display-defaults" data-testid="admin-settings-panel-display-defaults">`. Inner `data-testid="timeframe-defaults-section"` preserved. |
| `Provider API keys` card (~line 828) | Moved from outside `<TabsRoot>` into new `<TabsContent value="api-keys" data-testid="admin-settings-panel-api-keys">`. Inner `data-testid="admin-settings-provider-keys-section"` preserved. |
| Inline comment (~lines 301-303) | Removed/replaced — claimed cards were "intentionally outside tabs" (KZO-199 framing). Now reversed. |

### `libs/test-e2e/src/assistants/layout/AppShellAssert.ts`

Added private `ensureDisplayDefaultsTabActive()` helper. Called at the top of all assertion helpers that read through `timeframe-defaults-section`:
- `adminTimeframeSectionIsVisible`
- `adminTimeframeChipIsActive`
- `adminTimeframeChipIsInactive`
- `adminTimeframeChipIsAbsent`
- `adminTimeframeChipsInOrder`

### `libs/test-e2e/src/assistants/layout/AppShellActions.ts`

`ensureAdminSettingsTabActive(slug)` (pre-existing helper) extended to handle `"display-defaults"`. Called at the top of all action helpers reading through `timeframe-defaults-section`:
- `fillAdminTimeframeAddInput`
- `clickAdminTimeframeSaveButton`
- Drag helpers that operate on timeframe chips

`navigateToAdminSettingsTab(slug)` is the public alias for `ensureAdminSettingsTabActive(slug)`.

**Design note:** The gate must be in BOTH `*Assert.ts` AND `*Actions.ts`. Assertion-side gate alone is insufficient — action helpers on the moved section will silently operate on a hidden panel if the gate is only in the asserter.

### Test files — Implementer-owned renames

| File | Change |
|---|---|
| `apps/web/test/components/admin/AdminProvidersClient.test.tsx` | Renamed `provider-rerun-tooltip-trigger-*` → `provider-help-trigger-*` at 3 sites (lines 156, 160, 175) |
| `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` | Renamed `provider-rerun-tooltip-trigger-*` → `provider-help-trigger-*` (lines 344, 362); renamed `provider-rerun-tooltip-content-*` → `provider-help-popover-*` (line 366); updated `.hover()` → `.click()` for popover trigger |
| `apps/web/tests/e2e/specs-oauth/admin-settings-tier-a-aaa.spec.ts` | Added `await appShell.actions.navigateToAdminSettingsTab("api-keys")` before API-key testid assertions |
| `apps/web/tests/e2e/specs-oauth/admin-settings-tier-b-aaa.spec.ts` | Extended slug-loop from 5 to 7 slugs (added `"display-defaults"` and `"api-keys"`) |

### Test files — QA-authored behavioral coverage

| File | New tests |
|---|---|
| `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` | 4 new tests in `describe.serial` block: `[providers-popover-A/B/C/D]` — click-to-open, outside-click dismiss, Escape dismiss (table variant), card variant click |
| `apps/web/tests/e2e/specs-oauth/admin-settings-tier-b-aaa.spec.ts` | 4 new tests in `describe.serial` block: `[tab-display-defaults-A/B]`, `[tab-api-keys-A/B]` — tab trigger presence, panel content verification |

---

## Locked Testid Table

(Copied verbatim from `architect-design.md` — the canonical locked contract for this PR.)

| Surface | Table testid | Card testid |
|---|---|---|
| Popover trigger | `provider-help-trigger-{id}` | `provider-help-trigger-card-{id}` |
| Popover content | `provider-help-popover-{id}` | `provider-help-popover-card-{id}` |
| Tab trigger (settings) | `admin-settings-tab-display-defaults`, `admin-settings-tab-api-keys` | — |
| Tab panel (settings) | `admin-settings-panel-display-defaults`, `admin-settings-panel-api-keys` | — |
| Preserved (relocated) | `timeframe-defaults-section`, `admin-settings-provider-keys-section` | — |
| Removed | `provider-rerun-tooltip-trigger-{id}`, `provider-rerun-tooltip-content-{id}` (+ `-card-` variants) | — |

---

## Removed Testids (breaking change for external consumers)

The following testids were fully removed from source and all test files. Any external automation querying these will silently miss:

- `provider-rerun-tooltip-trigger-{id}` — table variant
- `provider-rerun-tooltip-content-{id}` — table variant
- `provider-rerun-tooltip-trigger-card-{id}` — card variant
- `provider-rerun-tooltip-content-card-{id}` — card variant

Migration: use `provider-help-trigger-{id}` / `provider-help-popover-{id}` (+ `-card-` variants).

---

## Behavioral Changes

| Area | Old behavior | New behavior |
|---|---|---|
| Provider help | Hover `?` icon → tooltip shown | Click provider name → popover shown; click outside or Escape → dismissed |
| Provider name cell | `truncate` — name clipped to column width | `break-all` — name wraps on hyphens |
| Timestamp cells | `whitespace-nowrap` — overflows column | Default wrap — splits on comma-space of locale date |
| Dashboard Timeframe Defaults card | Visible under every tab (outside TabsRoot) | Visible only under `Display defaults` tab |
| Provider API keys card | Visible under every tab (outside TabsRoot) | Visible only under `API keys` tab |
| Admin settings tab count | 5 tabs | 7 tabs (`display-defaults` and `api-keys` appended) |

The behavioral change is **intentional, not a regression** for all rows above. The KZO-199 framing that these were correct behaviors has been reversed.

---

## Page-Object Caller Impact

Existing caller specs (the ~30 call sites across `specs-oauth/` that use `adminTimeframe*` assert and action helpers) required **zero changes**. The `ensureDisplayDefaultsTabActive()` / `ensureAdminSettingsTabActive("display-defaults")` gate is applied inside the helpers transparently.

Any future spec that navigates to `/admin/settings` and reads the timeframe section does NOT need to call the tab-navigation helper explicitly — the helpers self-gate. Callers that need to explicitly land on a different tab should use `appShell.actions.navigateToAdminSettingsTab(slug)`.

---

## Code Review Summary (Phase 5)

**Verdict:** FIX-REQUIRED → fixed mechanically before merge.

| Severity | Finding | Resolution |
|---|---|---|
| MEDIUM-1 | Indentation inconsistency in moved `<Card>` blocks — inner `<div className="space-y-5">` children retained 8-space indent while outer `<Card>` was at 10-space after relocation into `<TabsContent>`. | Fixed: all inner children re-indented +2 spaces in `AdminSettingsClient.tsx:692` and `:838`. |
| LOW-1 | Stale TDD-RED preamble comments in new QA `describe` blocks (`provider-health-aaa.spec.ts:437-441`, `admin-settings-tier-b-aaa.spec.ts:371-377`). Tests are green post-implementation; comments say "TDD-RED until..." | Non-blocking. Next-PR follow-up to replace with settled comments. |
| INFO-I-2 | `<CardDetail truncate />` on last-success, last-failed, errors, rate-limit fields in the mobile card variant is intentional. Only the provider-name cell's `truncate` was in scope for removal. | Not a finding — documented for KZO-206 rule-authoring scope. |

---

## Cross-Link to KZO-206

Patterns P1–P5 surfaced during this PR's scope-grill session were promoted to [KZO-206's description](https://linear.app/kzokv/issue/KZO-206) on 2026-05-12. This PR's diff is the canonical reference for KZO-206's eventual wrap-convention rule-authoring step.

| Pattern | Description |
|---|---|
| P1 | `<colgroup>` widths size columns explicitly (not `table-fixed` with equal widths) |
| P2 | Drop `truncate` on cells with natural break points; use `break-all` for hyphenated IDs, default wrap for locale timestamps |
| P3 | Replace hover-tooltip `?` icons with click-popovers anchored to the data cell |
| P4 | Testid pair `*-help-trigger-{id}` + `*-help-popover-{id}` (+ `-card-` variants per dual-layout rule) replaces `*-tooltip-trigger/content-{id}` |
| P5 | Keep `title={...}` on the wrapping element as SR/keyboard-only fallback |

---

## Commit Format Waiver

Commits in this PR omit the `KZO-XX:` prefix per user decision. This PR has no dedicated Linear ticket. The `commit-format.md` rule was waived on a per-PR basis. The waiver is documented in the PR body `## Notes` section.

This is the first recorded waiver of the commit-format rule. If this pattern repeats, consider adding a one-line clause to `.claude/rules/commit-format.md`: "User may waive the `KZO-XX:` prefix on a per-PR basis; document the waiver in the PR body `## Notes` section."

---

*Authored by team `admin-ui-bugs`, 2026-05-12. Branch `worktree-admin-ui-bugs`.*
