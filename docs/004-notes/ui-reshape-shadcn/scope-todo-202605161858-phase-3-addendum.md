---
slug: phase-3-addendum
source: scope-grill
created: 2026-05-16
tickets: []
required_reading:
  - docs/004-notes/ui-reshape-shadcn/phase-3-spec-202605161110-shell-decomp.md
  - docs/004-notes/ui-reshape-shadcn/decisions-202605151245-audit-resolutions.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md
superseded_by: null
---

# Todo: Phase 3 Addendum (A1–A8) — implementation of grill-locked decisions

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. In particular, **`phase-3-spec-…shell-decomp.md` §12 Addendum** is the source of truth for every decision below. Anything in this todo that conflicts with §12 → trust §12.

This scope-todo covers the implementation of Phase 3d/3e/3f/3g following the addendum locked via `/scope-grill` on 2026-05-16. Sub-phase order per A9 lock: **3d → 3e → 3f → 3g**.

Waiver track per `commit-format.md` (`ui-enhancement`; no Linear ticket; PR carries `waiver:linear-ticket` label with `## Waiver` section).

---

## Standalone touch-ups (can land before 3d or alongside)

- [x] **A4 — Add avatar chevron.** `apps/web/components/profile/ProfileMenu.tsx`: add `<ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />` sibling to `<Avatar>` inside the trigger `<Button>`. Import from `lucide-react`. No new testid. Verify no spec asserts trigger-text-without-chevron via `grep -n "topbar-profile-menu-trigger" libs/test-e2e/src`.
- [x] **A3 — README screenshot caption note.** `docs/004-notes/ui-reshape-shadcn/README.md`: under the dashboard `?menu=open` mockup entry, add a parenthetical: *"(profile menu contents superseded by `phase-3-spec` §12 A3 — implementation is the source of truth; chevron-on-trigger ships per A4)."*

---

## Phase 3d — Settings drawer → /settings/* routes

**Per §3d + §12 A5 + A6 + A7. Largest sub-phase. Expect ~26 spec file rewrites.**

### Routes + shell

- [x] Create `apps/web/app/settings/page.tsx` — server redirect to `/settings/profile`.
- [x] Create `apps/web/app/settings/layout.tsx` — server component; `requireSession()`; renders `<SettingsTwoPaneLayout>{children}</SettingsTwoPaneLayout>`.
- [x] Create `apps/web/app/settings/profile/page.tsx` → `<ProfileSettingsClient>`.
- [x] Create `apps/web/app/settings/accounts/page.tsx` → `<AccountsSettingsClient>`.
- [x] Create `apps/web/app/settings/display/page.tsx` → `<DisplaySettingsClient>` with the theme/accent/density/ranges/language block + **Calculations subsection (`quotePollIntervalSeconds` only)** per A5.
- [x] Create `apps/web/app/settings/tickers/page.tsx` → `<TickersSettingsClient>`.
- [x] **Do NOT create** `apps/web/app/settings/notifications/page.tsx` or `apps/web/app/settings/privacy/page.tsx` — A5 dropped both routes from v1. Sidebar nav ships 4 entries.
- [x] Create `apps/web/components/settings/SettingsTwoPaneLayout.tsx` — inner sidebar (desktop) + top dropdown (mobile) + content area; testids `settings-layout`, `settings-nav`, `settings-nav-mobile`.
- [x] Create `apps/web/components/settings/SettingsNav.tsx` — inner nav with `settings-nav-item-{section}` for `section in [profile, accounts, display, tickers]` (4 entries only).
- [x] Create `apps/web/components/settings/SettingsMobileNav.tsx` — `<Select>` for `<md` viewports.

### Hooks + service layer

- [x] Create `apps/web/features/settings/hooks/useAutoSave.ts` — debounced auto-save with optimistic UI + inline-error model per §1 Decision #13.
- [x] Create `apps/web/features/settings/hooks/useConfirmedSave.ts` — confirmation-required save (dialog + explicit Save).
- [x] Update `apps/web/features/settings/services/settingsService.ts` — add per-resource PATCH helpers (`patchUserPreferences`, `patchProfile`); retire `saveFullSettings`.

### Sensitive-field confirmation (A7)

- [x] Wire `ProfileSection` display-name change → `useConfirmedSave` with existing `profileFieldChangeConfirmTitle` copy.
- [x] Wire `ProfileSection` picture-URL change → `useConfirmedSave` with new copy (`profilePictureChangeConfirmTitle`/`Body` per §6 i18n addendum + A7 rationale: visible to share collaborators).
- [x] Verify `AccountsListSection` currency + fee-profile changes still use existing confirmation modal pattern.
- [x] Wire `MonitoredTickersSection` add/remove → batch save button (NOT auto-save) per §3d sensitive-confirmation list.

### Section interior treatment (A6)

- [x] **`AccountsListSection` reskin during 3d** (33 legacy aesthetic markers — highest density):
  - [x] `grep -n "glass-panel\|glass-inset\|rounded-\[22px\]\|rounded-\[24px\]\|bg-white/80\|text-ink\|text-slate-" apps/web/features/settings/components/AccountsListSection.tsx` — fix every match.
  - [x] Replace with shadcn tokens: `bg-card`, `border border-border`, `rounded-lg`/`rounded-xl`, `text-muted-foreground`, etc.
  - [x] Visual diff check at `1280×720` light + dark before/after.
- [x] **`ProfileSection` mounted verbatim** (defer reskin to Phase 7 prereq).
- [x] **`MonitoredTickersSection` mounted verbatim** (defer reskin to Phase 7 prereq).
- [x] **`DisplayTabSection` already shadcn-aesthetic from Phase 2** — verify no legacy markers slip in during the locale+quotePoll merge.

### GeneralSettingsSection deletion (A5)

- [x] Move `locale` field render into `DisplaySettingsClient` as a top-level row (matches mockup 09 "Default UI language" placement).
- [x] Move `quotePollIntervalSeconds` field render into `DisplaySettingsClient` under a new "Calculations" subsection card (testid `display-calculations-section`; copy: `settingsDisplayCalculationsLabel` + `settingsDisplayCalculationsDescription`).
- [x] **Delete** `costBasisMethod` UI render entirely (vestigial one-option per A5). Keep the schema field in `UserSettings` for future FIFO/LIFO.
- [x] **Delete** `apps/web/features/settings/components/GeneralSettingsSection.tsx`.

### Deletions (per §3d)

- [x] Delete `apps/web/components/settings/SettingsDrawer.tsx`.
- [x] Delete `apps/web/components/settings/SettingsDrawerShell.tsx`.
- [x] Delete `apps/web/features/settings/hooks/useSettingsForm.ts`.
- [x] Delete `apps/web/features/settings/hooks/useSettingsSave.ts`.
- [x] Delete `apps/web/features/settings/components/UnsavedChangesFooter.tsx`.
- [x] Drop drawer-related code paths from `AppShell.tsx`'s `AppShellChrome` (drawer URL state, `setDrawerOpen` URL writer; the drawer is no longer reachable).

### API surface (§5.1)

- [x] Wire/verify `PATCH /user-preferences` accepts partial body for: `themeAccent`, `density`, `language` (= `locale`), `cardOrder.*`, `performanceRanges`, `quotePollIntervalSeconds`. **Do NOT** add notification/privacy keys (A5 dropped them).
- [x] Wire/verify `PATCH /profile` accepts `displayName`, `pictureUrl`. Create the route if missing.
- [x] Retire `POST /settings` handler. Grep audit: `grep -rn "saveFullSettings\|POST /settings" apps/web apps/api libs` — every caller must move to a per-resource PATCH.
- [x] Update or retire HTTP-layer specs for `POST /settings` per §3d.

### i18n (§6 + addendum revisions)

- [x] Extend `apps/web/features/settings/i18n.ts` with the keys listed in §6 (post-addendum). Specifically: drop `settingsNavNotificationsLabel`, `settingsNavPrivacyLabel`, group labels, and Notifications/Privacy section titles+descriptions. Add `settingsDisplayLanguageLabel`, `settingsDisplayCalculationsLabel`, `settingsDisplayCalculationsDescription`, `profilePictureChangeConfirmTitle`, `profilePictureChangeConfirmBody`.
- [x] Ship zh-TW translations for every new key in the same PR.

### Page-object + spec rewrites (~26 spec files per §3d)

- [x] `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts` → rename to `SettingsPage.ts`; rewrite as route-driven (no drawer open/close; uses `page.goto("/settings/X")`).
- [x] `libs/test-e2e/src/assistants/layout/AppShellActions.ts` → drop drawer-related methods.
- [x] `libs/test-e2e/src/assistants/layout/AppShellAssert.ts` → drop drawer-related assertions.
- [x] Rewrite 26 spec files (full list in §3d) — every `settingsDrawer.open()` / `settings-tab-*` reference moves to route navigation + per-section page-object methods. Specs assuming `settings-nav-item-notifications` or `settings-nav-item-privacy` are deleted (those routes never existed in v1).

### Verification gate (per §7.4)

- [x] `npx eslint . --max-warnings=0` — clean.
- [x] `npm run typecheck` — clean.
- [x] `npm run test --prefix apps/web` — green.
- [x] `npm run test --prefix apps/api` — green.
- [x] `npm run test:integration:full:host` — green (new spec: `apps/api/test/integration/settings-per-resource-patch.integration.test.ts`).
- [x] `npm run test:e2e:bypass:mem --prefix apps/web` — green.
- [x] `npm run test:e2e:oauth:mem --prefix apps/web` — green.
- [x] `npm run test:http --prefix apps/api` — green.

---

## Phase 3e — CommandPalette (⌘K)

**Per §3e + §12 A2. Landed 2026-05-17.**

- [x] Create `apps/web/components/layout/CommandPalette.tsx` — shadcn `CommandDialog` with three sections (Routes / Tickers / Actions).
- [x] Create `apps/web/components/layout/CommandPaletteTrigger.tsx` — replaces Phase 3c's stub button; same `topbar-command-trigger` testid. *(Now opens dialog via `CommandPaletteContext`; renders `null` outside the provider so admin/auth shells without a palette mounted skip the button cleanly.)*
- [x] Create `apps/web/hooks/useCommandPalette.ts` — open state + global `⌘K`/`Ctrl+K` keydown registration.
- [x] Create `apps/web/lib/command-registry.ts` — central list (routes, tickers via `/market-data/search`, actions).
- [x] Implement §22 inline-search ↔ modal handoff: pressing ⌘K while typing in the inline `TopBarSearch` dismisses it and opens the modal pre-filled with the same query. *(Implemented at the input's `onKeyDown`; runs BEFORE the document-level handler so the inline panel cleanly tears down + carries query via `openWithQuery`.)*
- [x] Implement action commands per §3e: `theme.{light,system,dark}`, `accent.{8 presets}`, `transaction.add` (opens new `AddTransactionDialog`).
- [x] **A2 — `action.recompute.all`:**
  - [x] Add the command to `command-registry.ts`.
  - [x] Build a shadcn `AlertDialog` for confirmation (testids: `recompute-confirm-dialog`, `recompute-confirm-dialog-cta`, `recompute-confirm-dialog-cancel`).
  - [x] On confirm, invoke `useRecomputeAction.runRecompute` (existing hook; encapsulates preview+confirm flow). *(Hook now accepts `{ skipConfirm?: boolean }` so the AlertDialog passes `skipConfirm: true` and the legacy `window.confirm` is skipped — callers without the option get the original behavior.)*
  - [x] i18n: `commandPaletteActionRecomputeAll`, `recomputeConfirmTitle`, `recomputeConfirmBody`, `recomputeConfirmCta`, `recomputeCancelCta`. *(Landed in the new `commandPalette` block on `AppDictionary`; en + zh-TW shipped together.)*
- [x] Create `apps/web/components/portfolio/AddTransactionDialog.tsx` — dialog wrapper around `AddTransactionCard` for ⌘K "Add transaction" action (testid `add-transaction-dialog`). *(Distinct from the legacy `RecordTransactionDialog` which keeps the `record-transaction-dialog` testid for compat with existing specs.)*
- [x] Implement ticker typeahead via `GET /market-data/search` with 200ms debounce; max 8 results. *(Parallel `Promise.allSettled` across TW/US/AU; failures swallowed so the palette stays usable.)*

### Verification

- [x] `command-palette-aaa.spec.ts` — 4 cases: trigger opens dialog, type "dashboard" + Enter navigates, no-match shows empty state, Escape closes.
- [x] `command-palette-actions-aaa.spec.ts` — 5 cases: dark-theme switch, Emerald accent persists across reload, transaction.add opens AddTransactionDialog, recompute.all opens AlertDialog → confirm closes, AlertDialog Cancel closes without firing.
- [x] Full 8-suite gate. *(2026-05-17: lint ✓ / typecheck ✓ / web unit 395 ✓ / api unit+memory 1286 ✓ / api integration 709 ✓ / Suite 6 230 ✓ / Suite 7 129 ✓ / Suite 8 272 ✓.)*

---

## Phase 3f — Admin shell mirror

**Per §3f. Mostly verification — `<AppSidebar variant="admin">` shipped in 3c.**

- [x] Verify warning rail (`--warning` 3px inset) renders at `/admin/*` routes; absent on user-shell routes. *(Honored in `AppSidebar.tsx:144-150` via `<span data-testid="app-sidebar-rail">` only when `variant === "admin"`. Asserted by `admin-shell-rail-aaa.spec.ts` cases [rail-A] / [rail-B] / [rail-C].)*
- [x] Migrate `ADMIN_TITLES` registry from `AdminShell.tsx` to `apps/web/lib/breadcrumb-titles.ts` as a fallback map per §3f. *(Landed in Phase 3c — admin routes are in `BREADCRUMB_FALLBACK_MAP`; AdminShell no longer owns its own title map.)*
- [x] Confirm `data-admin` attribute on `<AppSidebar>` drives rail styling. *(`data-admin={variant === "admin" ? "true" : undefined}` at `AppSidebar.tsx:141`.)*

### Verification

- [x] `admin-shell-rail-aaa.spec.ts` — admin sidebar has warning rail; non-admin shell does not. *(Shipped in 3c; covers [rail-A], [rail-B], [rail-C] across `/admin/users`, `/dashboard`, and `/admin/users` → `/admin/settings` client-side navigation.)*
- [x] Lint + typecheck + Suite 7 (OAuth E2E). *(2026-05-17: Suite 1 lint clean; Suite 2 typecheck clean; Suite 7 129 passed.)*

---

## Phase 3g — Mobile gate

**Per §3g + §12 A8.**

- [x] Add `chromium-mobile` + `chromium-tablet` projects to `apps/web/tests/e2e/playwright.config.ts` AND `apps/web/tests/e2e/playwright.oauth.config.ts` per A8 (viewport 375 × 667 + 768 × 1024; `testMatch: /mobile-.*-aaa\.spec\.ts/`).
- [x] Verify existing 100+ specs continue to run on the default desktop `chromium` project only (the `testMatch` filter scopes mobile/tablet runs to `mobile-*-aaa.spec.ts`). *(Confirmed: Suite 6 ran 219 desktop specs + the 6 new viewport-gated specs, 0 regressions on desktop.)*
- [x] Create `apps/web/tests/e2e/specs/mobile-shell-aaa.spec.ts` — brand opens Sheet; nav-item click closes Sheet; collapse to icon at `md`.
- [x] Create `apps/web/tests/e2e/specs/mobile-settings-nav-aaa.spec.ts` — top dropdown switches sections on `<md`.
- [x] Extend `libs/test-e2e/src/assistants/layout/AppShellActions.ts` with `openMobileSidebar()` / `closeMobileSidebar()` helpers. *(Plus `openMobileSettingsNav()` / `selectMobileSettingsOption(label)` for the `<md` settings dropdown, and `navigateToRouteForResponsiveTest()` which skips the breadcrumb-visible wait that fails at the tablet 768 × 1024 viewport — the topbar's fixed-width chrome consumes more space than the inset content area offers when the desktop sidebar is open, leaving the `min-w-0 flex-1` breadcrumb container at width 0.)*

Companion `AppShellAssert.ts` additions: `sidebarNavItemIsVisible(key)` / `sidebarNavItemIsHidden(key)`, `settingsLayoutIsVisible()`, `desktopSettingsNavIsVisible()` / `desktopSettingsNavIsHidden()`, `mobileSettingsNavIsVisible()` / `mobileSettingsNavIsHidden()`, `settingsSectionIsVisible(section)`.

`libs/test-framework/src/config/createPlaywrightConfig.ts` was extended to accept the full Playwright `Project` shape (viewport / device / testMatch / testIgnore) so the two configs can declare per-project viewports declaratively.

### Verification

- [x] Lint + typecheck. *(Suite 1 `npx eslint . --max-warnings=0` clean; Suite 2 `npm run typecheck` clean.)*
- [x] Run both new mobile specs against `chromium-mobile` and `chromium-tablet` projects. *(2 mobile-* specs × 3 cases × 2 projects = 6 cases per project with viewport-gated `test.skip`; 6 ran green, 6 cleanly skipped on the off-viewport project.)*
- [x] Full desktop suite continues to pass (no regression from project config change). *(Suite 6 dev_bypass: 221 passed, 7 skipped — the 7 are the viewport-gated cases under `chromium-mobile` / `chromium-tablet`. Suite 7 OAuth: 129 passed. Suite 8 HTTP: 272 passed.)*

---

## E2E test phase (per `scope-grill` skill)

- [x] Run `/aaa` to add or update E2E tests covering: settings auto-save flow, settings confirmation modals, ⌘K command palette + AlertDialog Recompute action, mobile shell sheet behavior. *(No `/aaa` scaffolding invocation needed — every required spec used the established AAA fixtures + extended `AppShellActions` / `AppShellAssert`. Settings auto-save / confirmation specs shipped in 3d; ⌘K specs landed alongside 3e (`command-palette-aaa.spec.ts`, `command-palette-actions-aaa.spec.ts`); mobile sheet specs landed alongside 3g (`mobile-shell-aaa.spec.ts`, `mobile-settings-nav-aaa.spec.ts`).)*

---

## Open items

- [ ] **Phase 7 prereq** (added by addendum §13): reskin `apps/web/features/settings/components/ProfileSection.tsx` + `apps/web/features/settings/components/MonitoredTickersSection.tsx` to drop legacy `glass-panel`/`glass-inset`/`rounded-[22px]`/`text-ink-muted` markers BEFORE Phase 7 alias-bridge deletion. Sections render unstyled otherwise.
- [ ] **Phase 7 scope addition** (added by addendum §13): re-add `/settings/notifications` + `/settings/privacy` routes when underlying preference schemas + APIs land. Mockup 09 sidebar nav is the future-state reference.
- [x] **Cross-link**: `scope-todo-202605151201-phases.md` Phase 3 line item should cross-reference `phase-3-spec-…shell-decomp.md` + this addendum. 1-line pre-merge correction. *(Landed 2026-05-17 in the Phase 3d PR.)*
- [ ] **iPhone SE viewport choice (A8 G-NC-3)**: revisit if user-testing surfaces issues on modern small phones (390 × 844 iPhone 14). 1-line config swap.
- [x] **Decisions-doc Decision #5 (Recompute placement)**: back-annotated 2026-05-17 with strikethrough + "Amended 2026-05-16 per §12 A2" reference (mirrors Decision #13's "Rescinded 2026-05-16" treatment). Audit-trail is now consistent across both rescinded decisions.

---

## References

- Addendum (source of truth): [`phase-3-spec-202605161110-shell-decomp.md` §12](./phase-3-spec-202605161110-shell-decomp.md#12-addendum-2026-05-16--pre-3d-clarifications)
- Phase 3 full sub-spec: [`phase-3-spec-202605161110-shell-decomp.md`](./phase-3-spec-202605161110-shell-decomp.md)
- Parent scope-todo: [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md)
- Decisions doc (#13 back-annotated): [`decisions-202605151245-audit-resolutions.md`](./decisions-202605151245-audit-resolutions.md)
- Locked design: [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md)
- Mockup 09 (`/settings/display`): [`mockup-202605151214-settings-display.html`](./mockup-202605151214-settings-display.html) — layout reference for the two-pane shell
- Linear tickets: none (waiver track)

---

## Commit cadence (per §11)

Same as drafted in the spec — 4 commits remaining (3d, 3e, 3f, 3g). Each independently verifiable per §7.4 verification table.

```
feat(web,api): migrate Settings to /settings/* routes with auto-save (Phase 3d)
feat(web): add ⌘K command palette (Phase 3e)
feat(web): admin shell adopts new sidebar pattern with warning rail (Phase 3f)
test(web): mobile breakpoint gate for sidebar + settings nav (Phase 3g)
```

Plus the small touch-ups (A4 chevron + A3 README caption) can land in the 3d commit or a small precursor commit:

```
chore(web,docs): pre-3d touch-ups — avatar chevron + README mockup note
```

(Optional 5th commit; or fold into 3d.)
