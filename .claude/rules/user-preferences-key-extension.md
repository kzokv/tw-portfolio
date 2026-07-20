# User Preferences Key Extension Checklist

When adding a new top-level key under `user_preferences.preferences`, keep the API, web, and tests aligned in one slice.

## Required steps

1. Add a shared schema and explicit DTO/type in `libs/shared-types/src/index.ts` when both API and web need the shape.
2. Extend `userPreferencePatchSchema` in `apps/api/src/routes/registerRoutes.ts`; the route is `.strict()`, so unknown top-level keys are rejected until explicitly added.
3. Reuse existing `GET /user-preferences` and `PATCH /user-preferences` unless the feature needs a genuinely separate endpoint.
4. Do not add a DB migration for an ordinary top-level JSONB preference key. Add one only for a dedicated column, index, or database-level constraint.
5. Remember persistence semantics: top-level keys merge, `null` deletes, and nested objects are replaced wholesale except special-cased keys such as `cardOrder`. If a feature needs partial nested patches, update both Memory and Postgres persistence paths atomically. Preserve unmentioned sibling and opaque fields, and define how an explicit reset removes stale nested keys rather than leaving an invalid partial object.
6. On the web, hydrate with a cancelled `useEffect` GET and persist via PATCH. If nested merge is not implemented, PATCH the full nested preference object.
7. Reconcile saved values against current known IDs: drop unknown values, dedupe, append newly added defaults, and ensure the selected item is visible/valid.

## Test expectations

- API route coverage: valid round trip, GET echo, `null` clear, invalid enum/id, duplicate list, and invalid selected/hidden combinations when applicable.
- Web component coverage: hydration from `GET /user-preferences`, PATCH body shape, visible/hidden state, and recovery when the active option is hidden or filtered to zero rows.
- Persistence parity tests are required only when changing merge/delete semantics; otherwise existing JSONB persistence tests cover the storage path.
- When merge/delete semantics change, exercise the same sibling-preservation and stale-key-deletion cases against Memory and managed Postgres. A memory-only round trip is not evidence that the JSONB path has equivalent behavior.
- OAuth E2E preference seeding must use the browser-authenticated user per `.claude/rules/e2e-oauth-seed-as-browser.md`.

## Why

The dashboard-reporting-ui Holding Focus slice added `dashboardHoldingFocus` with `presetOrder`, `hiddenPresets`, and `selectedPreset`. The safe path was shared Zod validation, strict API schema extension, full-object PATCH from the card, no migration, and focused API/web tests.

The holdings-table-sorting slice added per-surface sort field and direction inside an existing nested holdings settings object. Atomic deep merge was required so one surface update did not erase column settings or other surfaces, while a Custom/reset patch had to remove both stale sort keys. Matching Memory and managed-Postgres tests made those semantics explicit.
