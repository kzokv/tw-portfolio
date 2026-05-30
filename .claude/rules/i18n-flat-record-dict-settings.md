# i18n: `dict.settings` Must Stay Flat `Record<string, string>`

`apps/web/lib/i18n/types.ts`'s `settings` payload is consumed by indexed-access call sites — most notably `apps/web/features/settings/components/AccountsListSection.tsx:617` does `dict.settings[field.label]` to render a column header keyed by a runtime string. Adding any **non-string** value (e.g. a nested object, an array, a function) to the `settings` map widens that lookup's union type to include the new value shape and breaks React's `ReactNode` narrowing at the JSX site, with a non-obvious typecheck failure:

```
Type 'Record<string, string>' is missing the following properties from type 'ReactPortal': children, type, key, props
```

The error message points at the JSX site, NOT the dict-shape change — easy to mistake for a component bug.

## The rule

When adding a new i18n payload to `apps/web/features/settings/i18n.ts` (or the typed shape in `apps/web/lib/i18n/types.ts`):

- If the payload is a single string label/message → land it on `settings.X` as a `string`.
- If the payload is a `Record<string, string>` lookup table (e.g. sector display names, industry-group labels, status enum labels) → land it as a **sibling top-level key** on `dict`, not under `settings`.

```ts
// ❌ Wrong — breaks dict.settings[field.label] indexed-access narrowing
type SettingsDict = {
  tickersBrowseCatalog: string;
  // ...other flat strings...
  gics: {
    sectors: Record<string, string>;
    industryGroups: Record<string, string>;
  };
};

// ✅ Correct — sibling top-level key preserves flat-Record discipline
type Dict = {
  settings: {
    tickersBrowseCatalog: string;
    tickersAllSectors: string;
    tickersFilterBySector: string;
    tickersGicsOtherBucket: string;
    // ...all flat strings...
  };
  gics: {
    sectors: Record<string, string>;
    industryGroups: Record<string, string>;
  };
};
```

The flat-Record-discipline rule extends to any other top-level dict key whose values are accessed via runtime indexed lookup (currently `settings`; check `apps/web/lib/i18n/types.ts` for new candidates as the type evolves).

## Pre-PR audit

When reviewing any PR that extends `apps/web/features/settings/i18n.ts` or `apps/web/lib/i18n/types.ts`:

```bash
# Find indexed-access call sites against `dict.settings`:
grep -rn 'dict\.settings\[' apps/web/features apps/web/components apps/web/app
```

If any match exists and the PR adds a non-string value to `settings`, flag as a typecheck regression risk before merge.

## Why

KZO-196 — Frontend Implementer needed to add 11 GICS sector display names + 25 industry-group display names to the i18n shape. Initial draft nested them under `settings.gics`. `apps/web/features/settings/components/AccountsListSection.tsx:617`'s `dict.settings[field.label]` indexed access widened to `string | Record<string,string>`, and the JSX node `{dict.settings[field.label]}` became invalid because `Record<string,string>` does not satisfy `ReactNode`. The fix was to add `gics` as a sibling top-level key on `dict`, not under `settings` — the flat-Record discipline survives.

The bug is easy to repeat because:
1. The error surfaces at the JSX site, not the dict-shape change.
2. The indexed-access pattern (`dict.settings[runtimeStringKey]`) is invisible at code-review time unless you grep for it.
3. The "obvious" place to nest a settings-related dict is under `settings` — only the runtime-keyed access elsewhere in the codebase forces the flat shape.

## How to apply

- Frontend Implementer: when adding a `Record<string, string>` lookup table to the i18n shape, default to a sibling top-level key on `dict`, not under `settings` (or any other dict key consumed via runtime indexed access).
- Code Reviewer: grep for `dict\.X\[` patterns in any PR touching `apps/web/lib/i18n/types.ts`. Any non-string value added to `X` is a typecheck regression candidate.
- The same principle generalizes to any future top-level dict key that gains a runtime-indexed access pattern — call out the flat-Record contract in `types.ts` with a comment when the access pattern is added.
