# Phase 2 sub-spec — theme · accent · density

**Status:** Draft 2026-05-16. Awaiting user approval before implementation. Once approved → frozen; pre-merge corrections only per `doc-management.md`.
**Parent design:** [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md) §3.2 (presets) · §6 (density).
**Parent decisions:** [`decisions-202605151245-audit-resolutions.md`](./decisions-202605151245-audit-resolutions.md) #12 (admin layout) · #14 (custom accent).
**Implements scope-todo Phase 2** of [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md).

## 1. Architectural decisions (locked)

| # | Topic | Decision | Reason |
|---|---|---|---|
| 1 | User Settings → Display | **Add `DisplaySection.tsx` to the existing `SettingsDrawerShell`** (drawer-based, not a new route). | The mockup showed a full route for clarity; the actual app already uses a drawer with sibling sections (`ProfileSection`, `GeneralSettingsSection`, `AccountsListSection`, etc.). New section slots in next to those. Zero IA churn. |
| 2 | AdminSettings layout | **Defer the horizontal-tabs refactor to Phase 3.** For Phase 2: add the new "Display defaults" controls as a section inside the existing `AdminSettingsClient.tsx`. | The full horizontal-tabs refactor is decision #12, but it pairs naturally with the Phase 3 `AppShell` / sidebar decomposition. Bundling it here would balloon Phase 2 and force a parallel AdminShell migration. |
| 3 | Custom color picker library | **`react-colorful`** (1 kB gzipped, HSL + Hex inputs supported, no Radix conflicts). | Smallest. Has both `HslColorPicker` (2D hue/lightness panel) and `HexColorPicker`. Maintained. Zero peer-dep cost. |
| 4 | AA contrast policy | **Soft-warn.** Display the AA rating badge with pass/fail color, but allow Apply. | Hard-blocking annoys users who explicitly want lower-contrast aesthetics. The badge is informational. We persist whatever the user picked. |
| 5 | Theme mode storage | **`localStorage` only** (via `next-themes` `storageKey="vakwen-theme"`). | Per design §3.1 — different machines may have different ambient light. Theme is a device preference, not an account preference. |
| 6 | Accent + density storage | **`user_preferences.preferences` JSONB** (no DB migration). | Existing JSONB blob accepts new keys without schema change. Resolver follows `resolveEffectiveRanges` precedent. |
| 7 | Default precedence | **`user_value ?? admin_default ?? built_in_default`** at read time. User custom-color is preserved even if admin later changes the default preset. | Mirrors `resolveEffectiveRanges` in `apps/api/src/services/userPreferences.ts:53`. |
| 8 | Locked testids | See §5 below. | Required by `.claude/rules/playwright-page-object-testid-drift.md`. |

## 2. Data model

### 2.1 Schema additions to `user_preferences.preferences` JSONB

```jsonc
{
  // existing keys preserved:
  "cardOrder": { "dashboard": [...], "portfolio": [...], "transactions": [...] },
  "performanceRanges": ["1W","1M","3M","YTD","1Y"],

  // new in Phase 2:
  "themeAccent": { "kind": "preset", "preset": "indigo" }
    // or { "kind": "custom", "h": 238, "s": 84, "l": 60 }
  ,
  "density": "compact" | "comfortable"
}
```

### 2.2 Type definitions (`libs/shared-types/src/index.ts`)

```ts
export const ACCENT_PRESETS = ["indigo","violet","blue","cyan","emerald","amber","rose","slate"] as const;
export type AccentPreset = typeof ACCENT_PRESETS[number];

export type ThemeAccent =
  | { kind: "preset"; preset: AccentPreset }
  | { kind: "custom"; h: number; s: number; l: number };  // h:0-360, s:0-100, l:0-100

export type DensityMode = "compact" | "comfortable";

export const themeAccentSchema: z.ZodType<ThemeAccent> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(ACCENT_PRESETS) }),
  z.object({
    kind: z.literal("custom"),
    h: z.number().int().min(0).max(360),
    s: z.number().int().min(0).max(100),
    l: z.number().int().min(0).max(100),
  }),
]);

export const densitySchema = z.enum(["compact", "comfortable"]);
```

These are TYPE-ONLY exports — the Zod schemas live in `libs/shared-types`'s existing pattern (alongside `dashboardPerformanceRangesSchema`). No new runtime export risk (per `shared-types-barrel-turbopack.md`).

### 2.3 Built-in defaults

| Field | Built-in default |
|---|---|
| `themeAccent` | `{ kind: "preset", preset: "indigo" }` |
| `density` | `"compact"` |

### 2.4 Admin default columns

Add to `app_config` table via existing JSONB pattern OR new columns. **Decision: new typed columns** for clarity:

```sql
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS default_theme_accent JSONB NULL,
  ADD COLUMN IF NOT EXISTS default_density TEXT NULL CHECK (default_density IN ('compact','comfortable'));
```

One migration file: `056_uie_display_admin_defaults.sql`. Idempotent. NULL means "no admin default → use built-in".

## 3. Resolver

Add to `apps/api/src/services/userPreferences.ts`:

```ts
export interface EffectiveThemeAccentResult {
  value: ThemeAccent;
  source: "user" | "admin" | "default";
}

export async function resolveEffectiveThemeAccent(
  persistence: Persistence,
  userId: string,
): Promise<EffectiveThemeAccentResult> {
  const prefs = await persistence.getUserPreferences(userId);
  const userValue = themeAccentSchema.safeParse(prefs.themeAccent);
  if (userValue.success) return { value: userValue.data, source: "user" };

  const adminConfig = await persistence.getAppConfig();
  if (adminConfig.defaultThemeAccent) {
    return { value: adminConfig.defaultThemeAccent, source: "admin" };
  }

  return { value: { kind: "preset", preset: "indigo" }, source: "default" };
}

// Symmetric resolveEffectiveDensity(...) follows the same shape.
```

## 4. File deliverables

| File | Action |
|---|---|
| `db/migrations/056_uie_display_admin_defaults.sql` | new — app_config columns |
| `libs/shared-types/src/index.ts` | add `ACCENT_PRESETS`, `ThemeAccent`, `DensityMode` types + Zod schemas |
| `apps/api/src/persistence/types.ts` | extend `AppConfig` shape with `defaultThemeAccent`, `defaultDensity` |
| `apps/api/src/persistence/postgres.ts` | SELECT + UPDATE new columns; type guards on read |
| `apps/api/src/persistence/memory.ts` | mirror; honor unconditional admin-row writes per `test-placement-persistence-backend.md` |
| `apps/api/src/services/userPreferences.ts` | add `resolveEffectiveThemeAccent`, `resolveEffectiveDensity` |
| `apps/api/src/routes/registerRoutes.ts` | extend GET `/me/preferences` + PATCH `/me/preferences` + admin GET/PATCH `/admin/settings` |
| `apps/web/lib/theme.ts` | new — `accentPresetToHsl(preset, mode)` map; `applyAccent(accent)` runtime CSS-var setter |
| `apps/web/components/layout/ThemeToggle.tsx` | new — 3-state segmented control |
| `apps/web/components/layout/TopBar.tsx` | mount `<ThemeToggle />` |
| `apps/web/components/settings/DisplaySection.tsx` | new — full panel: theme · accent · density · language |
| `apps/web/components/settings/AccentSwatchPicker.tsx` | new — 9 swatches incl custom |
| `apps/web/components/settings/CustomAccentPicker.tsx` | new — `react-colorful` HSL picker + hex input + AA badge |
| `apps/web/components/settings/DensityToggle.tsx` | new — Compact/Comfortable switch |
| `apps/web/components/settings/SettingsDrawerShell.tsx` | mount `<DisplaySection />` |
| `apps/web/components/admin/AdminSettingsClient.tsx` | add "Display defaults" subsection (deferred horizontal-tabs refactor to Phase 3) |
| `apps/web/features/settings/hooks/useEffectivePreferences.ts` | new — fetches DTO, applies CSS vars on `<html>`, sets `data-density` attribute |
| `apps/web/features/settings/i18n.ts` | new keys per §6 |
| `apps/web/lib/i18n/types.ts` | extend dict shape (flat `Record<string, string>` per rule) |
| `apps/web/package.json` | add `react-colorful` |
| `apps/web/tests/e2e/specs/*.spec.ts` | new specs per §7 |

**No test framework changes.** Vitest + Playwright configs are stable since Phase 1.

## 5. Locked testid contract

Per `.claude/rules/playwright-page-object-testid-drift.md` — every testid declared up front.

### TopBar
- `theme-toggle` (container)
- `theme-toggle-light`
- `theme-toggle-system`
- `theme-toggle-dark`

### Settings → Display
- `display-section` (container)
- `display-theme-toggle` (mounted reuse of `theme-toggle`)
- `display-accent-swatch-{preset}` for preset in `[indigo, violet, blue, cyan, emerald, amber, rose, slate]`
- `display-accent-swatch-custom`
- `display-custom-accent-panel`
- `display-custom-accent-hue-slider`
- `display-custom-accent-saturation-slider`
- `display-custom-accent-hex-input`
- `display-custom-accent-aa-badge`
- `display-custom-accent-apply`
- `display-custom-accent-reset`
- `display-density-toggle-compact`
- `display-density-toggle-comfortable`
- `display-language-toggle-en`
- `display-language-toggle-zh-tw`

### Admin → Settings → Display defaults
- `admin-display-defaults-section`
- `admin-default-accent-swatch-{preset}`
- `admin-default-accent-swatch-custom`
- `admin-default-density-toggle-compact`
- `admin-default-density-toggle-comfortable`

Locked. Frontend Implementer must use these exact strings; Code Reviewer greps them.

## 6. i18n keys (additions)

Add to `apps/web/features/settings/i18n.ts` under `dict.settings`:

```ts
// Theme
themeSectionTitle: "Display",
themeModeLabel: "Theme mode",
themeModeDescription: "Choose how light and dark behave. System follows your OS preference automatically.",
themeLight: "Light",
themeSystem: "System",
themeDark: "Dark",
themeSavedOnDevice: "Saved on this device.",

// Accent
accentLabel: "Accent color",
accentDescription: "Sets the primary highlight across buttons, links, and charts. Status colors (gain / loss / warning) are unaffected.",
accentIndigo: "Indigo",
accentViolet: "Violet",
accentBlue: "Blue",
accentCyan: "Cyan",
accentEmerald: "Emerald",
accentAmber: "Amber",
accentRose: "Rose",
accentSlate: "Slate",
accentCustom: "Custom",
accentDefault: "default",
accentPickCustomHint: "or pick a custom hue ↓",

// Custom color picker
customAccentTitle: "Custom accent",
customAccentHue: "Hue",
customAccentSaturation: "Saturation",
customAccentHex: "Hex",
customAccentAaPass: "AA contrast: passed",
customAccentAaFail: "AA contrast: failed",
customAccentApply: "Apply",
customAccentReset: "Reset to Indigo",

// Density
densityLabel: "Density",
densityDescription: "Affects table row heights and list spacing. Compact shows ~10–12 rows per laptop screen; Comfortable trades density for breathing room.",
densityCompact: "Compact",
densityComfortable: "Comfortable",

// Language (unchanged scope — only labels added here for completeness)
languageLabel: "Language",
languageEn: "English",
languageZhTw: "繁體中文",
```

zh-TW translations added in same commit. All values are flat strings (per `i18n-flat-record-dict-settings.md`).

## 7. E2E test scope

4 new specs under `apps/web/tests/e2e/specs/`:

1. **`theme-toggle-aaa.spec.ts`**
   - Theme defaults to system; toggle to Dark → `<html class="dark">` present
   - Reload → still Dark (localStorage persistence)
   - Toggle to System → respects mocked `prefers-color-scheme: light`

2. **`accent-preset-aaa.spec.ts`**
   - Default accent = indigo; `--primary` reads `238 84% 60%` in light
   - Click Emerald swatch → `--primary` updates to `158 64% 40%` in light, `158 64% 52%` in dark
   - Reload → still Emerald (per-account persistence via `user_preferences`)

3. **`accent-custom-aaa.spec.ts`**
   - Click `accent-swatch-custom` → custom panel appears
   - Drag hue slider, enter hex `#5B6FFF`, click Apply → `--primary` updates
   - Reload → still custom; hex round-trips
   - Pick a low-contrast hex → AA badge shows fail color but Apply still works

4. **`density-toggle-aaa.spec.ts`**
   - Default density = compact; `data-density` absent on `<html>`
   - Toggle to Comfortable → `data-density="comfortable"` on `<html>`
   - Visit transactions page → table row height changes (verify via `getBoundingClientRect`)
   - Reload → still Comfortable

Specs land in the standard `specs/` directory (dev_bypass mode). Page objects update in `libs/test-e2e/src/pages/settings/` and `libs/test-e2e/src/pages/AppShell/`.

## 8. Implementation order

1. Land schema additions (migration + types + Zod schemas + persistence read/write + admin DTO field)
2. Land resolver + GET/PATCH routes
3. Land `lib/theme.ts` + `useEffectivePreferences` hook
4. Land `ThemeToggle` + mount in TopBar
5. Land `DisplaySection` + child components + drawer mount
6. Land AdminSettings additions
7. Land i18n keys (en + zh-TW)
8. Land E2E specs + page-object updates
9. Verify: full eight-suite gate per `full-test-suite.md`

## 9. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Initial paint flashes wrong accent | `next-themes` already handles theme FOUC. For accent, render server-side using the user's stored preference (read from session cookie's `userId` → preferences); apply CSS-vars in an inline `<script>` in `<head>` before hydration. |
| Custom accent dark-mode adjustment | `applyAccent({kind:"custom", h, s, l})` sets `--primary` to provided values; in dark mode bumps `l` by +7 clamped to [0,100]. Same formula as the preset dark-variant table. |
| AA contrast checker false positives | Use the standard WCAG relative-luminance formula. Test against BOTH `--background` (page) and `--card` (surfaces). Show pass only if BOTH pass at 4.5:1. |
| Per-account-vs-per-device confusion | Mode = device (next-themes localStorage). Accent + density = account (user_preferences). The Display section header notes "Saved on this device" for theme and the rest is implicit per-account. |
| Page-object drift | Phase 2 introduces ~25 new testids; the locked list in §5 IS the contract. Implementer must mirror exactly; Code Reviewer greps. |
| Memory backend admin-row mirror gap | Per `test-placement-persistence-backend.md` — unconditional mirror when writing default_* columns to memory backend. |

## 10. Verification gate

End-of-phase: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` clean. CI matches.

Specific test counts to target (rough):
- Vitest web: 402 + ~15 (theme/accent/density unit tests) = ~417
- Vitest api: existing + ~8 (resolver tests for accent + density × 4 cases each)
- Integration: existing + ~6 (Postgres admin/user round-trip)
- HTTP: existing + ~4 (GET/PATCH preferences + admin)
- E2E bypass + oauth: existing + 4 new specs
