# Web Frontend Architecture

## Layering

- `components/ui/*` contains reusable presentation primitives only.
- `components/*` outside `ui` should stay mostly presentational and consume feature hooks or feature models.
- `features/*/services/*` owns endpoint paths and request/response contract mapping.
- `features/*/hooks/*` owns workflow state, async orchestration, and derived UI state.
- `features/*/mappers/*` translates backend DTOs into UI-facing models.
- `features/*/validators/*` contains pure validation logic.

## Rules

- Page and layout components must not import `lib/api.ts` directly.
- Complex form components must not embed validation or API payload shaping inline.
- UI editing state should use feature models, not backend DTOs directly.
- New copy should live in feature-scoped i18n modules and be composed through `lib/i18n.ts`.

## Review checklist

- Does the component own more than one responsibility?
- Does the UI know backend field names like `feeProfileRef` or `tempId`?
- Does validation live in a pure function that can be unit tested?
- Does the change add or preserve a test seam for non-trivial logic?
