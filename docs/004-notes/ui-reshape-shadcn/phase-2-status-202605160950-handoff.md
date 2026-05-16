# Phase 2 handoff status — 2026-05-16

**Scope:** ui-reshape Phase 2 (theme · accent · density) per `phase-2-spec-202605160815-theme-density.md`.

## Shipped this session (4 commits on `worktree-ui-reshape-shadcn`)

| Commit | Phase | Files | Tests |
|---|---|---|---|
| `dee673e` | Sub-spec frozen | 1 | — |
| `af55230` | **2A** API foundation | 3 | API: 1285 ✓ |
| `c1c62da` | **2B** ThemeToggle in TopBar | 2 | Web: 402 ✓ |
| `1c638a2` | **2C** Accent picker + density toggle | 8 | Web: 402 ✓ · Build: 24 routes ✓ |

## API contract verified end-to-end (curl, in-session)

API on `localhost:4099` (PERSISTENCE_BACKEND=memory, AUTH_MODE=dev_bypass):

```
GET  /user-preferences                  → {"preferences":{}}
PATCH /user-preferences  preset+density → {"preferences":{"themeAccent":{kind:"preset",preset:"emerald"},"density":"comfortable"}}
GET  /user-preferences                  → round-trip preserved
PATCH /user-preferences  custom HSL     → {"themeAccent":{kind:"custom",h:91,s:80,l:55},"density":"comfortable"}
PATCH /user-preferences  bad preset     → 400 invalid_preference
PATCH /user-preferences  bad density    → 400 invalid_preference
```

Zod validation works at the route boundary. Custom + preset both round-trip through the JSONB blob.

## What's working in production code

- **Theme toggle** in TopBar (`<ThemeToggle />`) — Light · System · Dark. Persists per-device via `next-themes` (`storageKey="vakwen-theme"`). Hydration-safe.
- **Accent picker** in Settings drawer → Display tab — 8 preset swatches + 9th custom-color button. Custom panel uses `react-colorful`'s `HslColorPicker` + hex input + AA contrast badge (soft-warn).
- **Density toggle** — Compact (default) / Comfortable. Writes `[data-density]` on `<html>` immediately.
- **Apply-on-load** — `<AccentApplier />` mounts inside `<ThemeProvider>` in `app/layout.tsx`. On first client render fetches `/user-preferences`, parses via Zod, applies `--primary` + `--ring` + `--primary-foreground` + `data-density` to `<html>`. Re-applies accent on light↔dark switch (preset HSL is mode-specific).
- **Persistence** — `PATCH /user-preferences` accepts `themeAccent` (discriminated union) + `density` (enum). Validates with Zod. Stored as JSONB keys (no DB migration).
- **Built-in defaults** — `indigo` preset + `compact` density. Resolver supports admin-default tier (wiring deferred to follow-up).
- **i18n** — 12 new strings × 2 locales (en + zh-TW) added to `dict.settings`.

## What's left for full Phase 2 closure

### Phase 2D — E2E specs + verify gate (deferred)

- 4 new specs under `apps/web/tests/e2e/specs/`:
  - `theme-toggle-aaa.spec.ts` — Light/Dark/System toggle, persistence across reload, OS-pref follow
  - `accent-preset-aaa.spec.ts` — preset change updates `--primary`, persists, light/dark mode-variant
  - `accent-custom-aaa.spec.ts` — custom hex round-trip, AA badge pass/fail
  - `density-toggle-aaa.spec.ts` — density updates `[data-density]`, row heights change on transactions table
- Page-object additions:
  - `libs/test-e2e/src/pages/layout/AppShellPage.ts` — `actions.toggleTheme(mode)`, `assert.themeIs(mode)`
  - `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts` — `actions.openDisplayTab()`, `actions.selectAccentPreset(name)`, `actions.openCustomAccent()`, `actions.setAccentHex(hex)`, `actions.applyCustomAccent()`, `actions.setDensity(mode)`, `assert.*` mirrors
- Full eight-suite verification gate (per `.claude/rules/full-test-suite.md`).

### Admin-defaults follow-up (deferred)

- Migration `056_uie_display_admin_defaults.sql` — add `default_theme_accent` (JSONB) + `default_density` (TEXT CHECK) to `app_config`.
- `apps/api/src/persistence/types.ts` — extend the `getAppConfig()` return shape.
- `apps/api/src/persistence/{postgres,memory}.ts` — SELECT + write the new columns.
- `apps/api/src/services/userPreferences.ts` — update `resolveEffectiveThemeAccent` / `resolveEffectiveDensity` to consult `app_config` defaults before falling back to built-in.
- `apps/web/components/admin/AdminSettingsClient.tsx` — add "Display defaults" section with 9-swatch picker + density toggle.
- AdminSettings horizontal-tabs refactor (decision #12) stays bundled with Phase 3 sidebar work — NOT in this follow-up.

## Pickup commands

```bash
# Re-enter worktree
EnterWorktree path:.claude/worktrees/ui-reshape-shadcn

# Verify state is clean
git log --oneline -8
npx eslint apps/web --max-warnings=0
npm run typecheck

# Phase 2D pickup — start with page-object additions
$EDITOR libs/test-e2e/src/pages/layout/AppShellPage.ts
$EDITOR libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts

# Then specs
$EDITOR apps/web/tests/e2e/specs/theme-toggle-aaa.spec.ts
# ... etc

# Full gate (last)
npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
```

## Risk register (for next session)

| Risk | Mitigation |
|---|---|
| E2E discovers a real bug from Phase 2C not caught by unit tests | First spec is `theme-toggle-aaa` — simplest interaction; if it passes, the others likely will too. |
| AAA framework lock-in around testid contract | Spec §5 has all 25 testids locked; implementer uses exact strings. |
| Page-object drift in Phase 4 (DataTable migration) | `[data-density]` lives on `<html>`, not on tables. Phase 4 row-height changes inherit it via CSS var, no page-object change. |
| Admin migration adds column to a heavily-used table | `app_config` is one row, idempotent migration, low blast radius. |
