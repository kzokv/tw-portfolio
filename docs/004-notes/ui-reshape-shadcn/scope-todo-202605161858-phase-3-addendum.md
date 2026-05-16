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

- [ ] **A4 — Add avatar chevron.** `apps/web/components/profile/ProfileMenu.tsx`: add `<ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />` sibling to `<Avatar>` inside the trigger `<Button>`. Import from `lucide-react`. No new testid. Verify no spec asserts trigger-text-without-chevron via `grep -n "topbar-profile-menu-trigger" libs/test-e2e/src`.
- [ ] **A3 — README screenshot caption note.** `docs/004-notes/ui-reshape-shadcn/README.md`: under the dashboard `?menu=open` mockup entry, add a parenthetical: *"(profile menu contents superseded by `phase-3-spec` §12 A3 — implementation is the source of truth; chevron-on-trigger ships per A4)."*

---

## Phase 3d — Settings drawer → /settings/* routes

**Per §3d + §12 A5 + A6 + A7. Largest sub-phase. Expect ~26 spec file rewrites.**

### Routes + shell

- [ ] Create `apps/web/app/settings/page.tsx` — server redirect to `/settings/profile`.
- [ ] Create `apps/web/app/settings/layout.tsx` — server component; `requireSession()`; renders `<SettingsTwoPaneLayout>{children}</SettingsTwoPaneLayout>`.
- [ ] Create `apps/web/app/settings/profile/page.tsx` → `<ProfileSettingsClient>`.
- [ ] Create `apps/web/app/settings/accounts/page.tsx` → `<AccountsSettingsClient>`.
- [ ] Create `apps/web/app/settings/display/page.tsx` → `<DisplaySettingsClient>` with the theme/accent/density/ranges/language block + **Calculations subsection (`quotePollIntervalSeconds` only)** per A5.
- [ ] Create `apps/web/app/settings/tickers/page.tsx` → `<TickersSettingsClient>`.
- [ ] **Do NOT create** `apps/web/app/settings/notifications/page.tsx` or `apps/web/app/settings/privacy/page.tsx` — A5 dropped both routes from v1. Sidebar nav ships 4 entries.
- [ ] Create `apps/web/components/settings/SettingsTwoPaneLayout.tsx` — inner sidebar (desktop) + top dropdown (mobile) + content area; testids `settings-layout`, `settings-nav`, `settings-nav-mobile`.
- [ ] Create `apps/web/components/settings/SettingsNav.tsx` — inner nav with `settings-nav-item-{section}` for `section in [profile, accounts, display, tickers]` (4 entries only).
- [ ] Create `apps/web/components/settings/SettingsMobileNav.tsx` — `<Select>` for `<md` viewports.

### Hooks + service layer

- [ ] Create `apps/web/features/settings/hooks/useAutoSave.ts` — debounced auto-save with optimistic UI + inline-error model per §1 Decision #13.
- [ ] Create `apps/web/features/settings/hooks/useConfirmedSave.ts` — confirmation-required save (dialog + explicit Save).
- [ ] Update `apps/web/features/settings/services/settingsService.ts` — add per-resource PATCH helpers (`patchUserPreferences`, `patchProfile`); retire `saveFullSettings`.

### Sensitive-field confirmation (A7)

- [ ] Wire `ProfileSection` display-name change → `useConfirmedSave` with existing `profileFieldChangeConfirmTitle` copy.
- [ ] Wire `ProfileSection` picture-URL change → `useConfirmedSave` with new copy (`profilePictureChangeConfirmTitle`/`Body` per §6 i18n addendum + A7 rationale: visible to share collaborators).
- [ ] Verify `AccountsListSection` currency + fee-profile changes still use existing confirmation modal pattern.
- [ ] Wire `MonitoredTickersSection` add/remove → batch save button (NOT auto-save) per §3d sensitive-confirmation list.

### Section interior treatment (A6)

- [ ] **`AccountsListSection` reskin during 3d** (33 legacy aesthetic markers — highest density):
  - [ ] `grep -n "glass-panel\|glass-inset\|rounded-\[22px\]\|rounded-\[24px\]\|bg-white/80\|text-ink\|text-slate-" apps/web/features/settings/components/AccountsListSection.tsx` — fix every match.
  - [ ] Replace with shadcn tokens: `bg-card`, `border border-border`, `rounded-lg`/`rounded-xl`, `text-muted-foreground`, etc.
  - [ ] Visual diff check at `1280×720` light + dark before/after.
- [ ] **`ProfileSection` mounted verbatim** (defer reskin to Phase 7 prereq).
- [ ] **`MonitoredTickersSection` mounted verbatim** (defer reskin to Phase 7 prereq).
- [ ] **`DisplayTabSection` already shadcn-aesthetic from Phase 2** — verify no legacy markers slip in during the locale+quotePoll merge.

### GeneralSettingsSection deletion (A5)

- [ ] Move `locale` field render into `DisplaySettingsClient` as a top-level row (matches mockup 09 "Default UI language" placement).
- [ ] Move `quotePollIntervalSeconds` field render into `DisplaySettingsClient` under a new "Calculations" subsection card (testid `display-calculations-section`; copy: `settingsDisplayCalculationsLabel` + `settingsDisplayCalculationsDescription`).
- [ ] **Delete** `costBasisMethod` UI render entirely (vestigial one-option per A5). Keep the schema field in `UserSettings` for future FIFO/LIFO.
- [ ] **Delete** `apps/web/features/settings/components/GeneralSettingsSection.tsx`.

### Deletions (per §3d)

- [ ] Delete `apps/web/components/settings/SettingsDrawer.tsx`.
- [ ] Delete `apps/web/components/settings/SettingsDrawerShell.tsx`.
- [ ] Delete `apps/web/features/settings/hooks/useSettingsForm.ts`.
- [ ] Delete `apps/web/features/settings/hooks/useSettingsSave.ts`.
- [ ] Delete `apps/web/features/settings/components/UnsavedChangesFooter.tsx`.
- [ ] Drop drawer-related code paths from `AppShell.tsx`'s `AppShellChrome` (drawer URL state, `setDrawerOpen` URL writer; the drawer is no longer reachable).

### API surface (§5.1)

- [ ] Wire/verify `PATCH /user-preferences` accepts partial body for: `themeAccent`, `density`, `language` (= `locale`), `cardOrder.*`, `performanceRanges`, `quotePollIntervalSeconds`. **Do NOT** add notification/privacy keys (A5 dropped them).
- [ ] Wire/verify `PATCH /profile` accepts `displayName`, `pictureUrl`. Create the route if missing.
- [ ] Retire `POST /settings` handler. Grep audit: `grep -rn "saveFullSettings\|POST /settings" apps/web apps/api libs` — every caller must move to a per-resource PATCH.
- [ ] Update or retire HTTP-layer specs for `POST /settings` per §3d.

### i18n (§6 + addendum revisions)

- [ ] Extend `apps/web/features/settings/i18n.ts` with the keys listed in §6 (post-addendum). Specifically: drop `settingsNavNotificationsLabel`, `settingsNavPrivacyLabel`, group labels, and Notifications/Privacy section titles+descriptions. Add `settingsDisplayLanguageLabel`, `settingsDisplayCalculationsLabel`, `settingsDisplayCalculationsDescription`, `profilePictureChangeConfirmTitle`, `profilePictureChangeConfirmBody`.
- [ ] Ship zh-TW translations for every new key in the same PR.

### Page-object + spec rewrites (~26 spec files per §3d)

- [ ] `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts` → rename to `SettingsPage.ts`; rewrite as route-driven (no drawer open/close; uses `page.goto("/settings/X")`).
- [ ] `libs/test-e2e/src/assistants/layout/AppShellActions.ts` → drop drawer-related methods.
- [ ] `libs/test-e2e/src/assistants/layout/AppShellAssert.ts` → drop drawer-related assertions.
- [ ] Rewrite 26 spec files (full list in §3d) — every `settingsDrawer.open()` / `settings-tab-*` reference moves to route navigation + per-section page-object methods. Specs assuming `settings-nav-item-notifications` or `settings-nav-item-privacy` are deleted (those routes never existed in v1).

### Verification gate (per §7.4)

- [ ] `npx eslint . --max-warnings=0` — clean.
- [ ] `npm run typecheck` — clean.
- [ ] `npm run test --prefix apps/web` — green.
- [ ] `npm run test --prefix apps/api` — green.
- [ ] `npm run test:integration:full:host` — green (new spec: `apps/api/test/integration/settings-per-resource-patch.integration.test.ts`).
- [ ] `npm run test:e2e:bypass:mem --prefix apps/web` — green.
- [ ] `npm run test:e2e:oauth:mem --prefix apps/web` — green.
- [ ] `npm run test:http --prefix apps/api` — green.

---

## Phase 3e — CommandPalette (⌘K)

**Per §3e + §12 A2.**

- [ ] Create `apps/web/components/layout/CommandPalette.tsx` — shadcn `CommandDialog` with three sections (Routes / Tickers / Actions).
- [ ] Create `apps/web/components/layout/CommandPaletteTrigger.tsx` — replaces Phase 3c's stub button; same `topbar-command-trigger` testid.
- [ ] Create `apps/web/hooks/useCommandPalette.ts` — open state + global `⌘K`/`Ctrl+K` keydown registration.
- [ ] Create `apps/web/lib/command-registry.ts` — central list (routes, tickers via `/market-data/search`, actions).
- [ ] Implement §22 inline-search ↔ modal handoff: pressing ⌘K while typing in the inline `TopBarSearch` dismisses it and opens the modal pre-filled with the same query.
- [ ] Implement action commands per §3e: `theme.{light,system,dark}`, `accent.{8 presets}`, `transaction.add` (opens new `AddTransactionDialog`).
- [ ] **A2 — `action.recompute.all`:**
  - [ ] Add the command to `command-registry.ts`.
  - [ ] Build a shadcn `AlertDialog` for confirmation (testids: `recompute-confirm-dialog`, `recompute-confirm-dialog-cta`, `recompute-confirm-dialog-cancel`).
  - [ ] On confirm, invoke `useRecomputeAction.runRecompute` (existing hook; encapsulates preview+confirm flow).
  - [ ] i18n: `commandPaletteActionRecomputeAll`, `recomputeConfirmTitle`, `recomputeConfirmBody`, `recomputeConfirmCta`, `recomputeCancelCta`.
- [ ] Create `apps/web/components/portfolio/AddTransactionDialog.tsx` — dialog wrapper around `AddTransactionCard` for ⌘K "Add transaction" action (testid `add-transaction-dialog`).
- [ ] Implement ticker typeahead via `GET /market-data/search` with 200ms debounce; max 8 results.

### Verification

- [ ] `command-palette-aaa.spec.ts` — ⌘K opens; type "dashboard" → route item; Enter navigates; type ticker → live results.
- [ ] `command-palette-actions-aaa.spec.ts` — "Switch to dark" updates theme; "Change accent → Emerald" persists; "Add transaction" opens dialog; "Recompute all positions" opens AlertDialog → confirm → recompute fires.
- [ ] Full 8-suite gate.

---

## Phase 3f — Admin shell mirror

**Per §3f. Mostly verification — `<AppSidebar variant="admin">` shipped in 3c.**

- [ ] Verify warning rail (`--warning` 3px inset) renders at `/admin/*` routes; absent on user-shell routes.
- [ ] Migrate `ADMIN_TITLES` registry from `AdminShell.tsx` to `apps/web/lib/breadcrumb-titles.ts` as a fallback map per §3f.
- [ ] Confirm `data-admin` attribute on `<AppSidebar>` drives rail styling.

### Verification

- [ ] `admin-shell-rail-aaa.spec.ts` — admin sidebar has warning rail; non-admin shell does not.
- [ ] Lint + typecheck + Suite 7 (OAuth E2E).

---

## Phase 3g — Mobile gate

**Per §3g + §12 A8.**

- [ ] Add `chromium-mobile` + `chromium-tablet` projects to `apps/web/tests/e2e/playwright.config.ts` AND `apps/web/tests/e2e/playwright.oauth.config.ts` per A8 (viewport 375 × 667 + 768 × 1024; `testMatch: /mobile-.*-aaa\.spec\.ts/`).
- [ ] Verify existing 100+ specs continue to run on the default desktop `chromium` project only (the `testMatch` filter scopes mobile/tablet runs to `mobile-*-aaa.spec.ts`).
- [ ] Create `apps/web/tests/e2e/specs/mobile-shell-aaa.spec.ts` — brand opens Sheet; nav-item click closes Sheet; collapse to icon at `md`.
- [ ] Create `apps/web/tests/e2e/specs/mobile-settings-nav-aaa.spec.ts` — top dropdown switches sections on `<md`.
- [ ] Extend `libs/test-e2e/src/assistants/layout/AppShellActions.ts` with `openMobileSidebar()` / `closeMobileSidebar()` helpers.

### Verification

- [ ] Lint + typecheck.
- [ ] Run both new mobile specs against `chromium-mobile` and `chromium-tablet` projects.
- [ ] Full desktop suite continues to pass (no regression from project config change).

---

## E2E test phase (per `scope-grill` skill)

- [ ] Run `/aaa` to add or update E2E tests covering: settings auto-save flow, settings confirmation modals, ⌘K command palette + AlertDialog Recompute action, mobile shell sheet behavior. (Many of these are explicitly enumerated above as `*-aaa.spec.ts` files per §3d/§3e/§3g — `/aaa` ensures any missing AAA framework boilerplate is generated.)

---

## Open items

- [ ] **Phase 7 prereq** (added by addendum §13): reskin `apps/web/features/settings/components/ProfileSection.tsx` + `apps/web/features/settings/components/MonitoredTickersSection.tsx` to drop legacy `glass-panel`/`glass-inset`/`rounded-[22px]`/`text-ink-muted` markers BEFORE Phase 7 alias-bridge deletion. Sections render unstyled otherwise.
- [ ] **Phase 7 scope addition** (added by addendum §13): re-add `/settings/notifications` + `/settings/privacy` routes when underlying preference schemas + APIs land. Mockup 09 sidebar nav is the future-state reference.
- [ ] **Cross-link**: `scope-todo-202605151201-phases.md` Phase 3 line item should cross-reference `phase-3-spec-…shell-decomp.md` + this addendum. 1-line pre-merge correction.
- [ ] **iPhone SE viewport choice (A8 G-NC-3)**: revisit if user-testing surfaces issues on modern small phones (390 × 844 iPhone 14). 1-line config swap.
- [ ] **Decisions-doc Decision #5 (Recompute placement)**: still says "avatar menu and ⌘K". A2 amended via cross-reference; consider back-annotating Decision #5 with the same "Rescinded — see §12 A2" treatment Decision #13 got for full audit-trail consistency (low priority).

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
