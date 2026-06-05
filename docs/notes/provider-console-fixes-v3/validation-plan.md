# Provider Console Fixes V3 Validation Plan

This plan tracks the focused verification slices for the locked scope in [scope-todo.md](/Users/lume/repos/tw-portfolio-kzo197-guardrails/docs/notes/provider-console-fixes-v3/scope-todo.md:1).

## Component

- `apps/web/test/components/admin/AdminProvidersClient.test.tsx`
- Verify visible-page header checkbox selects and clears only rendered rows.
- Verify all-matching banner copy and count switch between selected-page and filtered scope.
- Verify row `Repair` and `Renew` send row-scoped `selected_items` payloads.
- Verify bulk `Repair` is blocked until a concrete selected scope exists.
- Verify selected and all-matching bulk Ignore/Unsupported actions send the correct scoped payload and guardrail confirmation.
- Verify execute blocker checklist reflects preparing preview, operation selection, token/typed phrase, and snapshot drift messaging.

## API

- `apps/api/test/integration/providerFixerRoutes.integration.test.ts`
- Verify preview accepts `selected_items` and `filter` scope payloads and freezes scope metadata.
- Verify dangerous filter preview returns `preparing_preview` first and later transitions to `preview`.
- Verify active operation conflict returns a typed 409 error.
- Verify execute rejects `preparing_preview`, snapshot drift, and mismatched confirmation with typed errors.
- Verify progress events still publish for preview completion and execution completion.
- Verify selected and all-matching bulk unresolved state changes enforce acknowledgement or typed confirmation and write operation outcomes.

## HTTP

- `apps/api/test/http/specs/provider-health-aaa.http.spec.ts`
- Verify typed error bodies for conflict/preparing/snapshot-drift flows at the route boundary.

## E2E

- `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts`
- Verify page-row selection, all-matching banner copy, row repair preview, and preparing-preview/execute guardrails in the admin console flow.

## Remaining Validation Gaps

- SSE scroll-preservation behavior needs a browser-level check after the selection state changes settle.
- Focused E2E coverage still needs to be rerun after the latest bulk action changes.
