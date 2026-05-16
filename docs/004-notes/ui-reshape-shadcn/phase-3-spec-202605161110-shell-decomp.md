# Phase 3 sub-spec — Sidebar + AppShell decomposition + Settings routes + ⌘K

**Status:** Frozen 2026-05-16. Pre-merge corrections allowed per `doc-management.md`. After merge, immutable.
**Parent design:** [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md) §7 (Wave B primitives) · §8 (IA) · §9 (responsive).
**Implements scope-todo Phase 3** of [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md), with structural amendments captured below.
**Grilling rounds:** two passes — see thread 2026-05-16. Audit identified 20 forks/gaps; all decided below.

---

## 1. Architectural decisions (locked)

| # | Topic | Decision | Reason |
|---|---|---|---|
| 1 | Admin sidebar tint | 3px inset `--warning` rail on left edge; `--card` background unchanged | Mockup wins over design-doc `--secondary` bg. Stronger operator signal without re-tinting whole panel. |
| 2 | Settings entry | Promote to `/settings/*` routes; retire `SettingsDrawer` entirely | Mockup IA wins. Breadcrumb-friendly, deep-linkable, no modal-overlay weirdness. |
| 3 | ⌘K palette | Full scope: routes + ticker typeahead + actions (Switch theme, Change accent, Add transaction) | Matches scope-todo verbatim. Reuses existing `/market-data/search` for tickers. |
| 4 | Breadcrumbs | Per-page `useBreadcrumb([...])` hook + `<BreadcrumbProvider>` in AppShell | Handles dynamic segments (`/tickers/2330 → "TSMC (2330)"`). Fallback to pathname → label map for pages that don't call the hook. |
| 5 | Settings layout | Two-pane: inner left sub-nav + content; sub-routes per section | Matches mockup verbatim. Each section is deep-linkable. |
| 6 | Sections taxonomy | Mockup labels for sections with existing content only. API keys + Import/Export dropped (no current code) | Reuse what exists; don't ship dead routes. |
| 7 | "General" tab split | Theme/accent/density/language → `/settings/display`; notification prefs → `/settings/notifications`; privacy bits → `/settings/privacy` | Mockup section names; today's `GeneralSettingsSection` splits accordingly. |
| 8 | Mobile breakpoints | sm/md/lg all gate Phase 3 | Aligns with design-doc §1 ("responsive everywhere"). |
| 9 | ⌘K "Add transaction" | Opens a Dialog overlay mounted in AppShell that renders `AddTransactionCard` with its own form state | Keeps quick-add accessible from any page. Separate from inline dashboard instance (which keeps its own draft until Phase 5). |
| 10 | TopBar chrome | Rebuild `NotificationBell` (shadcn `Popover`) + `ProfileMenu` (`DropdownMenu` + `Avatar`) | Phase 3 is the right time. Avatar primitive (Wave B) consolidates `UserAvatarButton`'s hand-rolled initials/picture/error-fallback logic. |
| 11 | Avatar dropdown | Header (name + email) + Profile link + Settings link + Theme switcher + Sign out. Role-gated Admin link preserved when `role === "admin"` | Matches existing testids (`avatar-menu-settings`, `avatar-menu-admin`); just retargets Settings to `/settings`. |
| 12 | Save model | **Auto-save by default** (debounced on blur). **Explicit confirmation required for sensitive ops:** account currency/fee-profile change, profile fields (display name + picture), monitored tickers add/remove, account delete/restore/purge | Today's UnsavedChangesFooter + single Save button retire. Per-field commits via PATCH endpoints. |
| 13 | Validation failure | Optimistic UI: keep invalid input visible with inline error; previous valid value persists in DB until input becomes valid | User keeps typing freely. No aggressive revert. No stuck-invalid-state in DB. |
| 14 | Search UX | Inline type-in-place search panel stays in `TopBar` (today's pattern). ⌘K opens a separate modal `CommandDialog` sharing the same search index | Both UIs over one data source. Inline = quick filtering; modal = keyboard-first + action commands. |
| 15 | `CustomizeRangesPopover` location | Both: dashboard gear (anchored to trend chart) + `/settings/display` "Performance ranges" subsection. Shared component | Discoverability + convenience. Settings = persistent edit; gear = contextual quick edit. |
| 16 | Settings API shape | Per-resource endpoints (`PATCH /user-preferences`, `PATCH /profile`, `PATCH /accounts/:id`, `PUT /monitored-tickers`). Retire `POST /settings` | Auto-save model requires partial commits. Most endpoints already exist; reuse. |
| 17 | Sidebar collapsed-state storage | Cookie (`shadcn` default); SSR reads cookie and renders correct state on first paint | Per-device intent matches theme. No DB schema. Eliminates FOUC. |
| 18 | Mobile sidebar trigger | Brand/logo doubles as trigger on `<md`. On `≥md`, brand routes to `/dashboard` | Cleaner TopBar — no separate hamburger icon. Same element, different click behavior gated by `useViewport()`. |
| 19 | Mobile settings inner nav | Top dropdown/select with section labels; content fills screen | Familiar pattern; works with keyboard + screen readers; avoids nested-Sheet cognitive load. |
| 20 | Sub-phase sequencing | 3a (primitives) → 3b (renderSection extraction, no visual) → 3c (new shell) → 3d (settings routes) → 3e (⌘K) → 3f (admin shell mirror) → 3g (mobile gate) | 3b is the load-bearing prerequisite the scope-todo omits. Sequencing keeps each commit independently verifiable. |

---

## 2. Affected surfaces

### 2.1 Pages rebuilt by the new shell (no other behavior change)

| Surface | Path | What changes |
|---|---|---|
| Dashboard | `/dashboard` | Shell only; content extracted out of `renderSection` in 3b |
| Portfolio | `/portfolio` | Shell only; content extracted in 3b |
| Transactions | `/transactions` | Shell only; content extracted in 3b |
| Cash ledger | `/cash-ledger` | Shell only; page already passes `children` |
| Dividends | `/dividends` | Shell only; content extracted in 3b |
| Dividends review | `/dividends/review` | Shell only; content extracted in 3b. Merge with `/dividends` is Phase 5, NOT here |
| Sharing | `/sharing` | Shell only |
| Ticker detail | `/tickers/[ticker]` | Shell only |

### 2.2 New routes introduced

| Route | Content |
|---|---|
| `/settings` | Server redirect to `/settings/profile` |
| `/settings/profile` | `ProfileSection` → display name (auto-save w/ confirm), email (read-only), picture URL (auto-save w/ confirm), language |
| `/settings/accounts` | `AccountsListSection` — list, create, soft-delete, currency/fee-profile edits (auto-save w/ confirm for sensitive fields) |
| `/settings/display` | `ThemeToggle` + `AccentSwatchPicker` + `DensityToggle` + `PerformanceRangesForm` + language (auto-save, no confirm) |
| `/settings/tickers` | `MonitoredTickersSection` + `InstrumentCatalogSheet` (now full-page, not nested sheet). Auto-save w/ confirm |
| `/settings/notifications` | New stub page; reads/writes `user_preferences.notificationPrefs` (whatever today's `GeneralSettingsSection` holds for notifications). Auto-save |
| `/settings/privacy` | New stub page; holds sharing/privacy bits from today's `GeneralSettingsSection`. Auto-save |

### 2.3 Admin pages (AdminShell mirror)

| Path | What changes |
|---|---|
| `/admin` (overview) | New shell with warning rail; no content change |
| `/admin/settings` | New shell; `AdminSettingsClient` interior unchanged |
| `/admin/users`, `/admin/instruments`, `/admin/invites`, `/admin/providers`, `/admin/audit-log` | New shell only |

### 2.4 Out of Phase 3

- `/login`, `/auth/error`, `/invite/[code]`, `/share/[token]` — AuthShell + SharedShell live in Phase 5.

---

## 3. Sub-phase plan

### 3a — Add shadcn primitives (single commit)

```
npx shadcn@latest add -c apps/web sidebar breadcrumb navigation-menu avatar progress command
```

- No call-site changes.
- Verify: `npx eslint .`, `npm run typecheck`, `npm run build -w @vakwen/web` all green.

### 3b — Extract `renderSection` from `AppShell` (single commit, no visual change)

**Goal:** AppShell becomes `children`-driven for all pages. Existing tests pass unmodified.

| File | Action |
|---|---|
| `apps/web/app/dashboard/page.tsx` | Move dashboard JSX from `renderSection` case `"dashboard"` into this file as `<DashboardClient>`; pass to `<AppShell>{...}</AppShell>` |
| `apps/web/app/portfolio/page.tsx` | Same pattern for portfolio content |
| `apps/web/app/transactions/page.tsx` | Same for transactions |
| `apps/web/app/dividends/page.tsx` + `dividends/review/page.tsx` | Same for dividends content |
| `apps/web/components/dashboard/DashboardClient.tsx` | New — owns `useDashboardData`, `useDashboardPerformance`, dashboard `<SortableCardGrid>` |
| `apps/web/components/portfolio/PortfolioClient.tsx` | New — owns portfolio holdings + sortable grid |
| `apps/web/components/transactions/TransactionsClient.tsx` | New — owns transactions form + recent ledger + sortable grid |
| `apps/web/components/dividends/DividendsClient.tsx` | New — wraps existing dividends section |
| `apps/web/components/layout/AppShell.tsx` | Remove `renderSection` and its 400 LOC; keep `section` prop temporarily as no-op until 3c (delete in 3c) |
| `apps/web/components/layout/CardLayoutResetContext.tsx` | New — `cardLayoutResetCounts` move here; AppShell provides; clients consume |

**Verification gate:** Lint, typecheck, all 8 suites pass without any test changes. Visual diff vs main: pixel-identical.

### 3c — Build new `AppShell` + `AppSidebar` + decomposed `TopBar`

| File | Action |
|---|---|
| `apps/web/components/layout/AppShell.tsx` | Rewrite to: `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>` containing `<TopBar>` + `{children}`. Target ≤300 LOC |
| `apps/web/components/layout/AppSidebar.tsx` | New — shadcn `Sidebar` with primary nav. Role-gated admin entry. Collapse to icon on `md`, Sheet on `<md`. Brand-as-trigger on `<md` |
| `apps/web/components/layout/TopBar.tsx` | Rewrite to: brand link + `<Breadcrumb>` + inline `<SearchPanel>` + `<CommandPaletteTrigger>` (⌘K button) + `<NotificationBell>` + `<ProfileMenu>` + `<ThemeToggle>` + `<PortfolioSwitcher>`. Target ≤200 LOC |
| `apps/web/components/layout/Breadcrumb.tsx` | New — wraps shadcn `Breadcrumb`; consumes `useBreadcrumbContext()` |
| `apps/web/components/layout/BreadcrumbProvider.tsx` | New — context + `useBreadcrumb(items)` hook |
| `apps/web/components/layout/NotificationBell.tsx` | Rebuild on shadcn `Popover`; preserve SSE pre-connect pattern (`enabled: true`) per `react-useEventStream-preconnect-pattern.md` |
| `apps/web/components/layout/NotificationDropdown.tsx` | Rebuild inside Popover content |
| `apps/web/components/profile/ProfileMenu.tsx` | New — shadcn `DropdownMenu` + `Avatar`. Replaces `UserAvatarButton.tsx` |
| `apps/web/components/profile/UserAvatarButton.tsx` | **Delete in 3c.** Migrate testids to `ProfileMenu` |
| `apps/web/components/layout/ImpersonationBanner.tsx` | Unchanged shell wraps it above TopBar. Re-port ResizeObserver into AppShell or replace with CSS variable |
| `apps/web/components/layout/PortfolioSwitcher.tsx` | Repositioned but unchanged. Verify `CONTEXT_FALLBACK_REVOKED_EVENT` listener migrated to new shell |
| `apps/web/components/admin/AdminShell.tsx` | Reuse new `TopBar` + new `AppSidebar variant="admin"`. Drops ImpersonationBanner duplication |
| `apps/web/components/admin/AdminSidebar.tsx` | **Delete.** Replaced by `AppSidebar variant="admin"` |
| `apps/web/lib/sidebar-cookie.ts` | New — server-side cookie read for SSR sidebar state |

**Behaviors to preserve verbatim (verification checklist):**
- `CONTEXT_FALLBACK_REVOKED_EVENT` window listener
- `?as=ownerId` deep-link guard (`deepLinkAppliedRef`)
- `clearContextCookie()` on revoked-share fallback
- Shared-context dict mutation (`hasOwnerEmptyPortfolio` / `hasOwnerEmptyRecentTransactions`)
- `router.refresh()` on context change
- Impersonation banner above TopBar
- ApiClientErrorToast mount
- StatusToast mount
- Sonner toaster mount
- Theme toggle 3-state segmented in TopBar (Phase 2 carryover)

**Verification gate:** Lint, typecheck, all 8 suites pass. Visual diff vs main: shell visibly different; page content pixel-identical (since 3b already extracted content).

### 3d — Migrate Settings drawer to `/settings/*` routes

| File | Action |
|---|---|
| `apps/web/app/settings/page.tsx` | New — server redirect to `/settings/profile` |
| `apps/web/app/settings/layout.tsx` | New — server component; `requireSession()`; renders `<SettingsTwoPaneLayout>{children}</SettingsTwoPaneLayout>` |
| `apps/web/app/settings/profile/page.tsx` | New — `<ProfileSettingsClient>` |
| `apps/web/app/settings/accounts/page.tsx` | New — `<AccountsSettingsClient>` |
| `apps/web/app/settings/display/page.tsx` | New — `<DisplaySettingsClient>` (theme + accent + density + ranges + language) |
| `apps/web/app/settings/tickers/page.tsx` | New — `<TickersSettingsClient>` |
| `apps/web/app/settings/notifications/page.tsx` | New — `<NotificationsSettingsClient>` (notification prefs split out of GeneralSettingsSection) |
| `apps/web/app/settings/privacy/page.tsx` | New — `<PrivacySettingsClient>` (privacy bits from GeneralSettingsSection) |
| `apps/web/components/settings/SettingsTwoPaneLayout.tsx` | New — inner sidebar (desktop) / top dropdown (mobile) + content area |
| `apps/web/components/settings/SettingsNav.tsx` | New — inner nav with active-route highlight |
| `apps/web/components/settings/SettingsMobileNav.tsx` | New — `<Select>` for `<md` viewports |
| `apps/web/features/settings/hooks/useAutoSave.ts` | New — generic debounced auto-save hook with optimistic UI + inline-error model |
| `apps/web/features/settings/hooks/useConfirmedSave.ts` | New — confirmation-required save (dialog with explicit Save button) |
| `apps/web/features/settings/services/settingsService.ts` | Add per-resource PATCH helpers; retire `saveFullSettings` |
| `apps/web/components/settings/SettingsDrawer.tsx` | **Delete** |
| `apps/web/components/settings/SettingsDrawerShell.tsx` | **Delete** |
| `apps/web/features/settings/hooks/useSettingsForm.ts` | **Delete**; per-section forms own their state |
| `apps/web/features/settings/hooks/useSettingsSave.ts` | **Delete** |
| `apps/web/features/settings/components/UnsavedChangesFooter.tsx` | **Delete** |
| Existing section components (`ProfileSection`, `AccountsListSection`, `MonitoredTickersSection`, `GeneralSettingsSection`, `DisplayTabSection`) | Lift out of drawer wrapper; consume new `useAutoSave`/`useConfirmedSave` instead of the unified form. `GeneralSettingsSection` splits into Notifications + Privacy sections + Display additions |
| `apps/api/src/routes/registerRoutes.ts` | Wire per-resource PATCH handlers if missing. Retire POST /settings handler |
| API integration tests for POST /settings | Update or retire alongside endpoint |

**Sensitive-confirmation surfaces (modal w/ explicit Save):**
- `AccountsListSection` → currency + fee-profile change → existing confirmation modal pattern (preserve)
- `AccountSoftDeleteModal`, `AccountPermanentDeleteModal` → unchanged
- `ProfileSection` → display name + picture → confirmation modal (new)
- `MonitoredTickersSection` → ticker add/remove → batch save button (no auto-save)

**Spec/page-object rewrites (~26 spec files):**
- `apps/web/tests/e2e/specs/account-creation-aaa.spec.ts`
- `apps/web/tests/e2e/specs/account-display-aaa.spec.ts`
- `apps/web/tests/e2e/specs/account-fee-profiles-aaa.spec.ts`
- `apps/web/tests/e2e/specs/account-market-binding-aaa.spec.ts`
- `apps/web/tests/e2e/specs/monitored-tickers-aaa.spec.ts`
- `apps/web/tests/e2e/specs/settings-aaa.spec.ts`
- `apps/web/tests/e2e/specs/accent-custom-aaa.spec.ts`
- `apps/web/tests/e2e/specs/accent-preset-aaa.spec.ts`
- `apps/web/tests/e2e/specs/density-toggle-aaa.spec.ts`
- `apps/web/tests/e2e/specs/au-backfill-aaa.spec.ts`
- `apps/web/tests/e2e/specs/au-catalog-browser-aaa.spec.ts`
- `apps/web/tests/e2e/specs/au-catalog-sector-filter-aaa.spec.ts`
- `apps/web/tests/e2e/specs/au-ticker-discovery-aaa.spec.ts`
- `apps/web/tests/e2e/specs/fx-transfer-aaa.spec.ts`
- `apps/web/tests/e2e/specs/transaction-form-market-code-aaa.spec.ts`
- `apps/web/tests/e2e/specs/us-backfill-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/admin-impersonation-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/admin-settings-tier-b-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/card-reorder-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/portfolio-card-reorder-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/transactions-card-reorder-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/dashboard-reporting-currency-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/dashboard-timeframe-aaa.spec.ts`
- `apps/web/tests/e2e/specs-oauth/profile-tab-aaa.spec.ts`
- `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts` → rename + rewrite to `SettingsPage.ts` (route-driven)
- `libs/test-e2e/src/assistants/layout/AppShellActions.ts` → drop drawer-related methods
- `libs/test-e2e/src/assistants/layout/AppShellAssert.ts` → drop drawer-related assertions

### 3e — Build CommandPalette

| File | Action |
|---|---|
| `apps/web/components/layout/CommandPalette.tsx` | New — shadcn `CommandDialog` with three sections: Routes, Tickers, Actions |
| `apps/web/components/layout/CommandPaletteTrigger.tsx` | New — the "Search anything... ⌘K" button in TopBar |
| `apps/web/hooks/useCommandPalette.ts` | New — open state + global ⌘K/Ctrl+K keydown registration |
| `apps/web/lib/command-registry.ts` | New — central list of routes + action commands |
| `apps/web/components/portfolio/AddTransactionDialog.tsx` | New — dialog wrapper around `AddTransactionCard` for ⌘K "Add transaction" action |

**Action command list (Phase 3 ship):**
- `theme.light`, `theme.system`, `theme.dark`
- `accent.{preset}` × 8 presets
- `transaction.add` → opens AddTransactionDialog
- Routes: Dashboard, Portfolio, Transactions, Cash ledger, Dividends, Sharing, Tickers, Settings → Profile, Settings → Display, Settings → Accounts, etc.
- Tickers: live typeahead via `/market-data/search` with 200ms debounce; max 8 results

### 3f — Admin shell adopts new pattern

| File | Action |
|---|---|
| `apps/web/components/admin/AdminShell.tsx` | Already updated in 3c. Verify warning rail visible at admin routes |
| `apps/web/components/layout/AppSidebar.tsx` | `variant="admin"` switches nav set + applies `data-admin` for rail styling |

ADMIN_TITLES registry from `AdminShell.tsx` migrates to `apps/web/lib/breadcrumb-titles.ts` as a fallback map.

### 3g — Mobile gate

| File | Action |
|---|---|
| `apps/web/tests/e2e/playwright.config.ts` + `playwright.oauth.config.ts` | Add `viewport-sm` and `viewport-md` projects (or `test.use({viewport})` per spec) |
| `apps/web/tests/e2e/specs/mobile-shell-aaa.spec.ts` | New — Sheet open/close on `<md`; brand-as-trigger; sidebar nav item click closes Sheet |
| `apps/web/tests/e2e/specs/mobile-settings-nav-aaa.spec.ts` | New — top dropdown switches sections on `<md` |
| `libs/test-e2e/src/assistants/layout/AppShellActions.ts` | `openMobileSidebar()` / `closeMobileSidebar()` helpers |

---

## 4. Locked testid contract

Per `.claude/rules/playwright-page-object-testid-drift.md`.

### AppShell + AppSidebar
- `app-shell` (root)
- `app-sidebar` (container)
- `app-sidebar-brand` (also serves as mobile-Sheet trigger on `<md`)
- `app-sidebar-trigger` (desktop collapse `‹` button)
- `app-sidebar-nav-{key}` for `key in [dashboard, portfolio, transactions, cash-ledger, dividends, sharing, tickers, settings, admin]`
- `app-sidebar-rail` (the 3px warning rail on admin variant; presence asserted on `/admin/*`)

### TopBar
- `topbar` (container)
- `topbar-breadcrumb`
- `topbar-search-input` (inline search)
- `topbar-command-trigger` (⌘K button)
- `topbar-theme-toggle` (preserves Phase 2 `theme-toggle-{light,system,dark}`)
- `topbar-portfolio-switcher` (preserves existing `portfolio-switcher-*` interior testids)
- `topbar-notification-bell`
- `topbar-notification-popover`
- `topbar-profile-menu-trigger`

### ProfileMenu (avatar dropdown)
- `profile-menu-content`
- `profile-menu-header` (name + email)
- `profile-menu-profile-link` → `/settings/profile`
- `profile-menu-settings-link` → `/settings` (preserves `avatar-menu-settings` legacy testid via `aria-label`)
- `profile-menu-admin-link` → `/admin` (role-gated; preserves `avatar-menu-admin`)
- `profile-menu-theme-light`, `profile-menu-theme-system`, `profile-menu-theme-dark`
- `profile-menu-sign-out`

### NotificationBell
- `notification-bell-button`
- `notification-bell-unread-count`
- `notification-popover-content`
- `notification-item-{id}`
- `notification-mark-all-read`
- `notification-empty-state`

### CommandPalette
- `command-palette-dialog`
- `command-palette-input`
- `command-palette-empty`
- `command-palette-group-routes`
- `command-palette-group-tickers`
- `command-palette-group-actions`
- `command-palette-item-route-{key}`
- `command-palette-item-ticker-{symbol}-{marketCode}`
- `command-palette-item-action-{actionId}`

### Settings two-pane
- `settings-layout` (root)
- `settings-nav` (desktop inner sidebar)
- `settings-nav-mobile` (`<md` select)
- `settings-nav-item-{section}` for `section in [profile, accounts, display, tickers, notifications, privacy]`
- `settings-section-{section}` (content area root, one per route)

### Per-section roots (preserve existing testids inside)
- `settings-section-profile` wraps existing ProfileSection testids
- `settings-section-accounts` wraps existing AccountsListSection testids
- `settings-section-display` wraps Phase 2's `display-*` testids (`display-accent-swatch-*`, `display-theme-toggle`, etc.) + new `display-ranges-form`
- `settings-section-tickers` wraps existing MonitoredTickersSection testids
- `settings-section-notifications` (new)
- `settings-section-privacy` (new)

### Add transaction dialog (⌘K action)
- `add-transaction-dialog`
- Reuses existing `AddTransactionCard` interior testids unchanged

### Breadcrumb
- `breadcrumb-root`
- `breadcrumb-item-{index}` (0-indexed; rightmost = current page = `aria-current="page"`)

---

## 5. API changes

### 5.1 Endpoints used / introduced

| Endpoint | Status |
|---|---|
| `PATCH /user-preferences` | Exists. Extend to accept partial fields (theme accent, density, language, cardOrder, performanceRanges, notification prefs, privacy bits) |
| `PATCH /profile` | New if missing. Accepts `displayName`, `pictureUrl` |
| `PATCH /accounts/:id` | Exists. Auto-save uses partial body |
| `PUT /monitored-tickers` | Exists. Confirmation-required save |
| `POST /accounts` | Exists; unchanged |
| `DELETE /accounts/:id` (soft) | Exists; unchanged |
| `POST /admin/accounts/:id/purge` | Exists; unchanged |
| `GET /market-data/search` | Exists; reused by CommandPalette ticker typeahead |
| `POST /settings` | **Retired.** Remove handler. Update HTTP-layer specs |

### 5.2 No DB schema changes in Phase 3

All new section storage lives in existing `user_preferences.preferences` JSONB. Notification + privacy keys land as new fields inside the JSONB blob (no migration). Per `migration-strategy.md`, this avoids a new migration.

If notification prefs need typed columns later, that's a follow-up ticket.

---

## 6. i18n keys

New keys, all flat `Record<string, string>` per `i18n-flat-record-dict-settings.md` and `nextjs-i18n-serialization.md`.

### `apps/web/features/settings/i18n.ts` (extend)

```
settingsNavProfileLabel
settingsNavAccountsLabel
settingsNavDisplayLabel
settingsNavTickersLabel
settingsNavNotificationsLabel
settingsNavPrivacyLabel
settingsNavGroupPersonalLabel  ("Personal")
settingsNavGroupDataLabel      ("Data")
settingsSectionNotificationsTitle / Description
settingsSectionPrivacyTitle / Description
settingsAutoSavedNotice         ("Saved")
settingsAutoSavingNotice        ("Saving…")
settingsAutoSaveFailedNotice    ("Couldn't save — check your input")
profileFieldChangeConfirmTitle  ("Confirm profile change")
tickersBatchSaveButtonLabel
```

### `apps/web/lib/i18n/types.ts` (no new top-level groups — extend `settings` flat record)

### CommandPalette i18n (`apps/web/components/layout/i18n.ts` new or extend layout block)

```
commandPalettePlaceholder       ("Search anything…")
commandPaletteEmptyLabel        ("No results")
commandPaletteGroupRoutes       ("Routes")
commandPaletteGroupTickers      ("Tickers")
commandPaletteGroupActions      ("Actions")
commandPaletteActionThemeLight  ("Switch to light")
commandPaletteActionThemeSystem ("Switch to system")
commandPaletteActionThemeDark   ("Switch to dark")
commandPaletteActionAccentPrefix ("Change accent to {accent}")  // dot replaced at call site
commandPaletteActionAddTransaction ("Add transaction")
breadcrumbCurrentAriaLabel      ("Current page")
sidebarToggleAriaLabel
sidebarBrandMobileAriaLabel     ("Open navigation")
sidebarBrandDesktopAriaLabel    ("Go to dashboard")
```

All ZH-TW translations land in the same PR.

---

## 7. Test plan

### 7.1 New specs

| Spec | Suite | Purpose |
|---|---|---|
| `settings-routes-aaa.spec.ts` | E2E (specs/) | Navigate /settings → redirects to /settings/profile; inner-nav highlights active route; deep-link to /settings/display works |
| `settings-auto-save-aaa.spec.ts` | E2E (specs/) | Change theme/accent/density → no Save button; UI persists across reload |
| `settings-confirm-modal-aaa.spec.ts` | E2E (specs/) | Currency change requires confirmation; cancel keeps old value |
| `command-palette-aaa.spec.ts` | E2E (specs/) | ⌘K opens; type "dashboard" → route item; Enter navigates; type ticker → live results |
| `command-palette-actions-aaa.spec.ts` | E2E (specs/) | "Switch to dark" updates theme; "Change accent → Emerald" persists; "Add transaction" opens dialog |
| `mobile-shell-aaa.spec.ts` | E2E (specs/) at `<md` viewport | Brand opens Sheet; nav item click closes Sheet; collapse to icon at md |
| `mobile-settings-nav-aaa.spec.ts` | E2E (specs/) at `<md` viewport | Top dropdown switches sections |
| `breadcrumb-aaa.spec.ts` | E2E (specs/) | Per-page setBreadcrumb works; ticker detail shows "TSMC (2330)"; static fallback works |
| `admin-shell-rail-aaa.spec.ts` | E2E (specs-oauth/) | Admin sidebar has warning rail; non-admin shell does not |

### 7.2 Rewritten specs (page-object only; spec semantics preserved)

The 26 spec files listed in §3d each lose `settingsDrawer.open()` / `settings-tab-*` selectors and gain route navigation (`page.goto("/settings/display")`) + per-section page-object methods.

### 7.3 Unit + integration

- `apps/api/test/integration/settings-per-resource-patch.integration.test.ts` — new — verify per-resource PATCH endpoints persist partial updates
- HTTP specs touching POST /settings → retire or migrate to new endpoints
- Vitest specs for `useAutoSave` + `useConfirmedSave` hooks

### 7.4 Verification gate per sub-phase

| Sub-phase | Lint | TC | Vitest | API integ | Suite 6 | Suite 7 | Suite 8 |
|---|---|---|---|---|---|---|---|
| 3a | ✓ | ✓ | — | — | — | — | — |
| 3b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3c | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3d | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3e | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| 3f | ✓ | ✓ | — | — | — | ✓ | — |
| 3g | ✓ | ✓ | — | — | ✓ | ✓ | — |

All eight suites pass at end of Phase 3 per `full-test-suite.md`.

---

## 8. Behavioral preservation checklist (Code Reviewer hands-on)

For 3c specifically — every item below must be verifiable in the new shell:

- [ ] `CONTEXT_FALLBACK_REVOKED_EVENT` window listener registered and clears context cookie
- [ ] `?as=ownerId` deep link applied once via ref guard; URL cleaned via `replaceState`
- [ ] PortfolioSwitcher dropdown integrated; testids preserved
- [ ] Shared-context dictionary remapping for empty-portfolio/empty-transactions copy
- [ ] `router.refresh()` fires after context changes
- [ ] ImpersonationBanner renders above TopBar; ResizeObserver migrated or replaced with CSS variable
- [ ] ApiClientErrorToast mount point preserved
- [ ] StatusToast mount point preserved
- [ ] Sonner toaster mount preserved
- [ ] Theme toggle 3-state in TopBar (Phase 2 carryover)
- [ ] `useNotifications` hook keeps `enabled: true` (SSE pre-connect)
- [ ] Avatar dropdown role-gated Admin link preserves `avatar-menu-admin` testid
- [ ] Brand link routes to `/dashboard` on `≥md`; opens Sheet on `<md`
- [ ] Sidebar collapsed state SSR-renders from cookie (no FOUC)
- [ ] Warning rail visible on admin shell; absent on user shell
- [ ] Profile picture URL validation: HTTPS-only, `referrerPolicy="no-referrer"`, `onError` fallback (per `provider-url-sanitization.md`)
- [ ] Breadcrumb registry fallback for pages that don't call `useBreadcrumb`
- [ ] PortfolioSwitcher `seedAsBrowser` test fixture still works (per `e2e-oauth-seed-as-browser.md`)

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `renderSection` extraction (3b) introduces subtle hook-order or state-scope bugs | High | Run all 8 suites before merging 3b. Pixel-diff dashboard at 1280×800. |
| Settings page-object rewrites (3d) drift from component testids | High | Locked-testid contract enforced; grep audit per `playwright-page-object-testid-drift.md` |
| Per-resource PATCH endpoints conflict with omnibus POST /settings during convergence | Med | Land endpoints first, retire POST in same commit as web migration |
| Auto-save loses user input on validation failure | Med | Inline-error model: invalid input stays visible; previous valid value persists. Vitest + Playwright assertions per spec |
| Brand-as-trigger UX breaks on viewport boundary (resize while sidebar open) | Med | `useViewport()` hook resets sidebar state on breakpoint transition |
| ⌘K conflicts with browser/OS shortcuts | Low | `e.preventDefault()`; allow disable via `data-testid="command-palette-trigger"` button always available |
| Notification SSE regression (lost listener on rebuild) | Med | Verbatim test from existing `useNotifications.test.ts` |
| Mobile gate fixture work overflows into Phase 4 | Med | Time-box fixture work to 1 day; defer additional viewport specs to Phase 4 if tight |
| `CONTEXT_FALLBACK_REVOKED_EVENT` silently dropped in rewrite | High | Listed in §8 checklist; Code Reviewer enforces |
| `saveFullSettings` callers outside settings drawer (admin panel?) break when retiring POST | Med | Grep audit: `grep -rn "saveFullSettings\|/settings\"" apps/web apps/api` before retiring |
| Card layout reset counter scope-shift breaks existing card reorder tests | Med | 3b verifies before any shell change |

---

## 10. Out of scope (explicit)

- Public share view (`/share/[token]`) re-chrome — Phase 5
- AuthShell unification (`/login`, `/auth/error`, `/invite/[code]`) — Phase 5
- Dashboard re-prioritization (above-fold portfolio total + day Δ) — Phase 5
- `/dividends` + `/dividends/review` merge — Phase 5
- DataTable migration / responsive dual-DOM retirement — Phase 4
- API keys / Import-Export / Privacy real implementations — follow-up tickets
- Recharts → shadcn chart recipe — Phase 6
- Glass CSS deletion — Phase 7
- Adapter shim deletion — Phase 7

---

## 11. Commit shape

Per `commit-format.md` waiver track (`ui-enhancement`, no Linear ticket). PR carries `waiver:linear-ticket` label with `## Waiver` section.

```
feat(web): scaffold shadcn navigation primitives (Phase 3a)
refactor(web): extract renderSection into page components (Phase 3b)
feat(web): adopt shadcn sidebar + decomposed TopBar (Phase 3c)
feat(web,api): migrate Settings to /settings/* routes with auto-save (Phase 3d)
feat(web): add ⌘K command palette (Phase 3e)
feat(web): admin shell adopts new sidebar pattern with warning rail (Phase 3f)
test(web): mobile breakpoint gate for sidebar + settings nav (Phase 3g)
```

7 commits. Each independently verifiable.
