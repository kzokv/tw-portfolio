---
slug: phase-3d-transition
source: agent-team Tier 3 (ui-reshape-shadcn worktree)
created: 2026-05-17
tickets: []
phase: 3d
supersedes: null
superseded_by: null
required_reading:
  - docs/004-notes/ui-reshape-shadcn/phase-3-spec-202605161110-shell-decomp.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605161858-phase-3-addendum.md
  - docs/004-notes/ui-reshape-shadcn/decisions-202605151245-audit-resolutions.md
---

# Transition — UI Reshape Phase 3d (Settings drawer → `/settings/*` routes)

**Frozen snapshot.** Records what shipped in Phase 3d of the UI-reshape arc. Phase 3e (CommandPalette), 3f (admin shell verification), and 3g (mobile gate) are **deferred** to a follow-up session — see the *Risk/Rollback* section for the deferral note.

## Summary (TL;DR)

Phase 3d retired the monolithic `SettingsDrawer` overlay in favor of dedicated `/settings/{profile,accounts,display,tickers}` routes wrapped in a two-pane `SettingsTwoPaneLayout`. The form model moved from imperative `useSettingsForm` + `UnsavedChangesFooter` to a hooks pair (`useAutoSave` for debounced PATCH, `useConfirmedSave` for sensitive-field confirmation). The omnibus `PUT /settings/full` endpoint was retired in favor of per-resource PATCH endpoints. `GeneralSettingsSection` was deleted entirely (locale + `quotePollIntervalSeconds` moved to Display; `costBasisMethod` UI dropped as vestigial). `AccountsListSection` was reskinned to drop 33 legacy aesthetic markers. A latent React #185 infinite-loop in `BreadcrumbProvider`'s `useEffect` dep array was rooted out via a 1-line stable-ref fix. Page-object compatibility was preserved across ~19 specs via a thin `SettingsDrawerPage` shim that repoints to the new route-driven `SettingsPage` semantics. Standalone touch-ups A3 (README caption) and A4 (avatar chevron) landed in the same diff.

## Problem

Before Phase 3d:

- **Monolithic drawer**: `SettingsDrawer.tsx` (342 LOC) + `SettingsDrawerShell.tsx` + interior sections + `UnsavedChangesFooter` were reachable only via `?drawer=settings&settingsTab=…` URL state. No deep-linkable per-section route. Inner navigation was tab-based, not URL-driven.
- **Omnibus save**: `PUT /settings/full` accepted a single mega-payload (`settings + feeProfiles + accounts + bindings`) on every Save click. `useSettingsForm` + `useSettingsSave` orchestrated client-side diff + dirty-check + footer. The model conflated unrelated resources and made auto-save impossible.
- **Vestigial UI**: `costBasisMethod` shipped with one selectable option (FIFO). `GeneralSettingsSection.tsx` existed solely to host `locale`, `quotePollIntervalSeconds`, and that vestigial dropdown.
- **Aesthetic drift**: `AccountsListSection.tsx` carried 33 legacy markers (`glass-panel`, `glass-inset`, `rounded-[22px]`, `rounded-[24px]`, `bg-white/80`, `text-ink`, `text-slate-*`) that pre-dated the shadcn migration.
- **Latent React #185**: `BreadcrumbProvider.tsx` exported `useBreadcrumb(items)` whose effect listed the whole memo'd context value (`ctx`) as a dep. Each `setItems` call invalidated the Provider's `useMemo` → new `ctx` identity → consumer re-fired → loop. Symptom only surfaced under single-worker E2E on routes that mounted `TickerHistoryClient` (3 tests in `portfolio-snapshots-aaa.spec.ts`); parallel scheduling masked it pre-iteration-3.
- **Profile menu drift**: `ProfileMenu.tsx` trigger lacked a visual affordance for "this opens a menu" — no chevron.
- **Mockup ↔ implementation drift**: Mockup 12 (`12-dashboard-profile-menu-open.png`) showed pre-A3 menu contents (Sharing, Recompute, etc.) which were removed during the scope-grill freeze.

## Solution

### Routes + shell (S1, S2)

- New: `apps/web/app/settings/page.tsx` (server redirect to `/settings/profile`)
- New: `apps/web/app/settings/layout.tsx` (`requireSession()` + `<SettingsTwoPaneLayout>`)
- New: `apps/web/app/settings/{profile,accounts,display,tickers}/page.tsx` — 4 route entries (Notifications + Privacy deferred per A5)
- New: `apps/web/components/settings/{SettingsTwoPaneLayout,SettingsNav,SettingsMobileNav}.tsx`
- `apps/web/components/layout/AppSidebar.tsx` — Settings nav-item now navigates to `/settings`; `?drawer=settings` URL state retired from sidebar.

### Form model (S3, S4, S5)

- New hook: `apps/web/features/settings/hooks/useAutoSave.ts` — 600ms debounce on blur; optimistic UI; inline-error model per Decision #13 (invalid input persists in field, previous valid value persists in DB until valid).
- New hook: `apps/web/features/settings/hooks/useConfirmedSave.ts` — confirmation dialog + explicit Save; cancel reverts to last-saved value.
- `apps/web/features/settings/services/settingsService.ts` — added `patchUserPreferences()`, `patchProfile()` helpers; removed `saveFullSettings`.

### Sensitive-field confirmation (A7, S5)

- Display-name change → `useConfirmedSave` with existing `profileFieldChangeConfirmTitle` copy.
- Picture URL change → `useConfirmedSave` with new `profilePictureChangeConfirm{Title,Body}` copy (rationale per A7: visible to share collaborators).
- HTTPS-only picture URL validation per `.claude/rules/provider-url-sanitization.md` (rejects `http:`, `data:`, `javascript:`, file paths; empty string treated as clear).
- Monitored-tickers add/remove ships a batch Save button (NOT auto-save) per the §3d sensitive-confirmation list.

### Reskins, deletions, and stub drops (A5, A6, S6, S10)

- `AccountsListSection.tsx` — all 33 legacy aesthetic markers replaced with shadcn tokens (`bg-card`, `border border-border`, `rounded-lg`/`rounded-xl`, `text-muted-foreground`).
- Deleted: `apps/web/components/settings/SettingsDrawer.tsx`
- Deleted: `apps/web/features/settings/components/SettingsDrawerShell.tsx`
- Deleted: `apps/web/features/settings/components/UnsavedChangesFooter.tsx`
- Deleted: `apps/web/features/settings/components/GeneralSettingsSection.tsx` (A5: `locale` + `quotePollIntervalSeconds` moved to `/settings/display`; `costBasisMethod` UI dropped; schema field retained for future FIFO/LIFO)
- Deleted: `apps/web/features/settings/hooks/useSettingsForm.ts`
- Deleted: `apps/web/features/settings/hooks/useSettingsSave.ts`
- Deleted: `apps/web/components/layout/useSettingsDrawerNav.ts`
- Drawer cascade (`AppShell.tsx`, `AppShellLayout.tsx`, `AppShellChrome.tsx`, `useAppShellDataValue.ts`, `AppShellDataContext.tsx`, `DashboardClient.tsx`): drawer URL state, `setDrawerOpen`, all `openSettings` props rewired to `router.push("/settings")` or dropped.

### API surface (S7, S8)

- `PATCH /profile` extended (`apps/api/src/routes/registerRoutes.ts:2309`) — body now accepts `{ email?, displayName?, pictureUrl? }`. Empty string coerces to `null` (clear override). Zod parse lives BEFORE the try block per `typed-transient-error-catch-audit.md`. HTTPS-only validation inline; throws `routeError(400, "invalid_picture_url", …)` on violation.
- New persistence method: `updateProfileFields(userId, { displayName?, pictureUrl? })` on the `Persistence` interface (memory + Postgres). Three-state semantics: `undefined` = leave alone, `null` = clear, string = set.
- Storage: JSONB at `user_preferences.preferences.userProfile.{displayName,pictureUrl}`. **No DB migration.** When the `userProfile` sub-object empties out, it is stripped via `preferences - 'userProfile'`; unrelated top-level keys (`themeAccent`, `cardOrder`, `dashboardPerformanceRanges`) preserved via `jsonb_set(..., true)`.
- Retired: `PUT /settings/full` handler removed (~line 2781) along with `feeProfileDraftSchema`, `WRITER_ROLE_ROUTE_KEYS["PUT /settings/full"]`, and `WRITE_CONTEXT_GUARD_ROUTE_KEYS["PUT /settings/full"]`. Test-framework helpers `putFull`/`saveFull` removed from `SettingsEndpoint` + `SettingsApiActions`. 4 HTTP-spec tests deleted (covered on replacement endpoints); 4 integration setups in `portfolio.integration.test.ts` migrated to `PUT /settings/fee-config`.

### Shared-types contract (S7)

`ProfileDto` extended in `libs/shared-types/src/index.ts` with two optional fields:

- `userDisplayName: string | null`
- `userPictureUrl: string | null`

UI resolver: `userPictureUrl ?? providerPictureUrl`, `userDisplayName ?? displayName`. Provider-synced fields (`displayName`, `providerPictureUrl`) untouched on writes. Per `.claude/rules/shared-types-barrel-turbopack.md` — type-only additions, no runtime export added to the barrel, no Turbopack audit needed.

### Standalone touch-ups

- **A4 — Avatar chevron**: `apps/web/components/profile/ProfileMenu.tsx` — `<ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />` rendered as sibling to `<Avatar>` inside `topbar-profile-menu-trigger`. No new testid; existing avatar specs unchanged.
- **A3 — README caption**: `docs/004-notes/ui-reshape-shadcn/README.md` parenthetical caption under the `12-dashboard-profile-menu-open.png` row noting the mockup contents are superseded by §12 A3 (already on disk from the scope-grill freeze; verified, no change needed).

### React #185 / `BreadcrumbProvider` 1-line fix (iter 3)

```diff
- const ctx = useContext(BreadcrumbContext);
- useEffect(() => {
-   ctx?.setItems(items);
-   return () => ctx?.setItems(null);
- }, [signature, ctx]);
+ const ctx = useContext(BreadcrumbContext);
+ const setItems = ctx?.setItems ?? null;
+ useEffect(() => {
+   if (!setItems) return;
+   setItems(items);
+   return () => setItems(null);
+ }, [signature, setItems]);
```

The Provider's `value={useMemo(() => ({ items, setItems }), [items])}` recomputed on every `setItems(newItems)`, giving the consumer a new `ctx` identity each cycle. The fix extracts `ctx.setItems` (a React-stable setState ref) and drops the whole `ctx` from deps. Holistic audit of all `useContext + useEffect` patterns across `apps/web` found only one other candidate (`sidebar.tsx`, depends on a stable `useCallback` — non-risky).

### Page-object back-compat shim (S9)

`libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts` kept its class name and `openSettingsDrawer()` method name to preserve compile/run surface across ~19 existing spec files. Internally repointed to route-driven semantics:

- `el.drawer` → `settings-layout`
- `el.tabs.{profile,accounts,tickers,display}` → `settings-nav-item-{slug}`
- `tabs.general` → aliased to `tabs.display` (A5 — `/settings/general` retired)
- `openSettingsDrawer()` → `page.goto("/settings/profile")` + wait for `settings-layout`
- `save()` now waits for the next `PATCH /settings|/user-preferences|/profile` response
- `cancel()`, `keepEditing()`, `discardChanges()` are no-ops (auto-save has no "unsaved" concept)

QA's new behavioral specs cover the obsolete "drawer closes after save" / "discard notice appears" assertions.

### Locked-decision recap (A1–A8)

| ID | Decision | Outcome |
|---|---|---|
| A1 | Profile + bell stay in `<TopBar>` (Decision #13 corner-widget rescinded) | Honored — no chrome widget added. |
| A2 | Recompute placement → ⌘K AlertDialog (no avatar-menu entry) | **Deferred to Phase 3e** (out of scope this PR). |
| A3 | README mockup-12 caption | Caption present in `README.md`. |
| A4 | Avatar chevron (`<ChevronDown class="h-3 w-3 text-muted-foreground" aria-hidden>`) | Shipped in `ProfileMenu.tsx`. |
| A5 | Settings sections — drop Notifications + Privacy v1; drop `costBasisMethod`; merge `locale` + `quotePollIntervalSeconds` into Display | Shipped: 4 routes, 1 deletion, 1 merge. |
| A6 | Reskin `AccountsListSection` during 3d; mount `ProfileSection` + `MonitoredTickersSection` verbatim (Phase 7 prereq) | Shipped: 33 markers replaced; sibling sections mounted verbatim. |
| A7 | Picture URL requires confirmation (symmetric with display-name) | Shipped via `useConfirmedSave` + new `profilePictureChangeConfirm{Title,Body}` i18n. |
| A8 | Mobile viewports pinned at 375×667 + 768×1024 | **Deferred to Phase 3g** (out of scope this PR). |

### Behavioral deltas (intentional)

- **Auto-save** (Decision #12): `theme`, `accent`, `density`, `performanceRanges`, `locale`, `quotePollIntervalSeconds` all auto-save on debounced blur via `PATCH /user-preferences` or `PATCH /settings`. No Save button on Display.
- **Sensitive-field confirmation**: display-name + picture URL go through `useConfirmedSave` dialog (cancel reverts; not a regression — A7).
- **HTTPS-only picture URL**: 400 with `invalid_picture_url` code on `http:` / `data:` / `javascript:` / non-HTTPS URLs (not a regression — `provider-url-sanitization.md`).
- **`PUT /settings/full` → 404**: any client still calling the omnibus endpoint will 404. Production has no consumer (verified via `grep -rn "saveFullSettings\|/settings/full" apps/web apps/api libs` → 0 matches outside the deletion commit).

### Renamed / extended type surface

| Type / Endpoint | Before | After |
|---|---|---|
| `ProfileDto` | `displayName`, `providerPictureUrl`, `providerDisplayName` (+ email/role/etc.) | Above + `userDisplayName: string \| null`, `userPictureUrl: string \| null` |
| `PATCH /profile` request body | `{ email? }` | `{ email?, displayName?, pictureUrl? }` (string \| null \| undefined) |
| `PATCH /profile` response | `ProfileDto` (existing shape) | `ProfileDto` (extended shape; existing fields unchanged) |
| `PUT /settings/full` | Omnibus `{ settings, feeProfiles, accounts, bindings }` save | **Retired.** Use `PATCH /user-preferences`, `PATCH /profile`, `PATCH /accounts/:id`, `PUT /monitored-tickers`, `PUT /settings/fee-config` |
| Persistence interface | (no `updateProfileFields`) | `updateProfileFields(userId, { displayName?: string \| null, pictureUrl?: string \| null })` |

## Testing

Verification followed `.claude/rules/full-test-suite.md`'s 8-suite contract. Final Phase 5 v2 gate (iter 3, post-`BreadcrumbProvider` fix):

```
Evidence:
- Suite 1 (lint, `npx eslint . --max-warnings=0`)                                 — CLEAN
- Suite 2 (typecheck, `npm run typecheck`)                                        — CLEAN
- Suite 3 (web unit, `npm run test --prefix apps/web`)                            — 395 passed, 0 failed
- Suite 4 (api unit + memory-int, `npm run test --prefix apps/api`)               — 1286 passed, 0 failed, 401 skipped
- Suite 5 (api integration, `npm run test:integration:full:host`)                 — 709 passed, 0 failed, 1 skipped
- Suite 6 (web E2E bypass, `npm run test:e2e:bypass:mem --prefix apps/web`)       — 215 passed, 0 failed, 1 skipped
- Suite 7 (web E2E OAuth, `npm run test:e2e:oauth:mem --prefix apps/web`)         — 129 passed, 0 failed, 0 skipped
- Suite 8 (API HTTP, `npm run test:http --prefix apps/api`)                       — 272 passed, 0 failed, 2 skipped

React #185 cluster (tests 58 / 103 / 146 in portfolio-snapshots-aaa.spec.ts)      — all PASS deterministically (single-worker reproduction confirmed)
timeframe-L (dashboard-timeframe-aaa.spec.ts:192)                                  — no flake observed
lsof :4000/:3333/:4445/:4099                                                       — clean (no orphan processes)
```

Iter-by-iter convergence:

| Iter | Phase | Validator | Code Reviewer | Action |
|---|---|---|---|---|
| 1 | 3-iter-1 (gate) | Suite 6: 17 failed (14 stale page-object refs, 3 React #185) | FIX-REQUIRED: 3 HIGH + 2 MEDIUM + 1 LOW | Route 14 to QA spec-rewrites (§5.1–§5.3); route 3 React #185 to Frontend (§4.1–§4.4) |
| 2 | 5-iter-2 (gate) | Suite 6: 214/1/1 (test 103 deferred — D1 4/5 checklist); Suite 7: 129/0/0; all other suites clean | CLEAN (all 6 iter-1 findings closed) | Tie-breaker tests 58/103/146 ordered (single-worker) — all FAILED deterministically. Routed to Frontend iter 3 holistic audit per `agent-team-workflow.md` "3rd-strike same-class rule" |
| 3 | 5-iter-3 (gate) | All 8 suites green (counts above). React #185 cluster ALL PASS. | CLEAN — `BreadcrumbProvider` fix verified; holistic Provider+useEffect audit zero risky patterns | EXIT_CHECK_PASS. Zero deferrals. |

The new integration test `apps/api/test/integration/settings-per-resource-patch.integration.test.ts` covers 9 Postgres-backed cases (default-null projection, write/clear semantics for both override fields, `userProfile` cleanup on full clear, preservation of unrelated top-level JSONB keys across sequential PATCHes, 404 on missing user, isolation from provider-synced fields) + 1 memory-backed sibling per `.claude/rules/test-placement-persistence-backend.md`.

## Risk/Rollback

### What could go wrong post-merge

- **Latent React #185 elsewhere**: the `useEffect-on-Provider-memo` anti-pattern is sneaky — ESLint's exhaustive-deps satisfies the rule, TypeScript doesn't catch it (`unknown[]` deps), and parallel-worker E2E can mask it on routes that don't loop tightly. The holistic audit found only `sidebar.tsx` as a candidate (cleared — depends on a stable `useCallback`), but any new Provider added in Phases 3e/3f/3g or later must repeat the audit. **Architect-memory candidate `provider-memo-as-dep-pitfall` is staged at `.worklog/team/memory/architect.md` for promotion to `.claude/rules/react-provider-memo-dep.md`** in a follow-up session. Promoting it converts "did I check?" from a judgment call into a code-review checklist step.
- **`PUT /settings/full` callers in the wild**: grep audit across `apps/web apps/api libs` shows 0 matches. If any external test harness, browser extension, or unmerged feature branch still hits the endpoint, it will receive a 404. Mitigation: monitor `apps/api` error logs for `/settings/full` 404s in the week after merge.
- **JSONB cleanup edge case**: when both `userDisplayName` and `userPictureUrl` clear via `null`, the `userProfile` sub-object is stripped via `preferences - 'userProfile'`. Unrelated top-level keys preserved via the `jsonb_set(..., true)` upsert. Integration test case 5+6 cover this; regression risk is low but the JSONB SQL is the most subtle persistence change in the PR.
- **Page-object shim semantics shift**: `SettingsDrawerPage.save()` now waits for the next PATCH response; `cancel()`/`keepEditing()`/`discardChanges()` are no-ops. Any spec that depended on those being meaningful would have failed Suite 6 — the shim plus QA's spec rewrites in iter 1 cleared the surface, but a stale spec landing in a parallel PR could surface a confusing "auto-save has no concept of cancel" failure. Document in spec-author onboarding when next touched.

### Deferred follow-up work

- **Phase 3e (CommandPalette ⌘K)** — `/scope-todo §"Phase 3e"` checkboxes intentionally left UNTICKED. Defers ⌘K palette, `RecomputeConfirmDialog`, `AddTransactionDialog`, and the §22 inline-search ↔ modal handoff. A2 (Recompute placement decision) is encoded in the scope-todo but not yet shipped.
- **Phase 3f (Admin shell rail verification + `ADMIN_TITLES` final migration)** — checkboxes UNTICKED. Mostly verification work; `<AppSidebar variant="admin">` already shipped in Phase 3c.
- **Phase 3g (Mobile gate)** — checkboxes UNTICKED. Defers `chromium-mobile` + `chromium-tablet` Playwright projects, `mobile-shell-aaa.spec.ts`, `mobile-settings-nav-aaa.spec.ts`, and the `openMobileSidebar()` / `closeMobileSidebar()` page-object helpers.
- **Phase 7 prereqs** — reskin `ProfileSection.tsx` + `MonitoredTickersSection.tsx` to drop legacy markers BEFORE Phase 7's alias-bridge deletion. Tracked in scope-todo §"Open items".
- **Decisions-doc Decision #5 (Recompute placement)** — still says "avatar menu and ⌘K". A2 amended the menu side, but Decision #5 should be back-annotated with "Rescinded — see §12 A2" for full audit-trail consistency. Low-priority; defer if time-boxed. **Not a blocker for merge.**

### Rollback path

Revert is straightforward:

1. Revert the Phase 3d commit(s). The route group `apps/web/app/settings/*`, the new components under `apps/web/components/settings/`, and the new hooks under `apps/web/features/settings/hooks/` are net-new files — revert removes them cleanly.
2. The deleted drawer files (`SettingsDrawer.tsx`, `SettingsDrawerShell.tsx`, `useSettingsForm.ts`, `useSettingsSave.ts`, `useSettingsDrawerNav.ts`, `GeneralSettingsSection.tsx`, `UnsavedChangesFooter.tsx`) are restored via revert.
3. `PUT /settings/full` handler is restored via revert; the JSONB `userProfile` data in `user_preferences.preferences` (if any was written post-merge) becomes inert (no handler reads it) but is also harmless (revert doesn't delete data; can be cleaned up via ad-hoc `UPDATE … SET preferences = preferences - 'userProfile'` if desired).
4. `ProfileDto`'s two new optional fields revert to absent; downstream serializers ignore them safely (they were optional from the start).
5. `BreadcrumbProvider.tsx` 1-line fix reverts — but DO NOT revert that fix alone; the React #185 anti-pattern returns. If the rest of Phase 3d is reverted but the React fix is genuinely desired, cherry-pick the single-line fix forward.

## Waiver

**Reason:** No Linear ticket exists for Phase 3d. This work is part of the broader UI-reshape arc tracked entirely via `docs/004-notes/ui-reshape-shadcn/` (frozen design `design-202605151200-locked-scope.md`, phase plan `scope-todo-202605151201-phases.md`, sub-spec `phase-3-spec-202605161110-shell-decomp.md`, and the §12 scope-grill addendum). The arc was scoped under the project's existing `ui-enhancement` waiver track per `.claude/rules/commit-format.md`; no per-phase tickets were created.

**Approved-by:** @keith-tw

**Scope:** both
