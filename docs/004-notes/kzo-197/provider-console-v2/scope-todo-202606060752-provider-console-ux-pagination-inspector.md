---
slug: kzo-197-provider-console-ux-pagination-inspector
source: scope-grill
created: 2026-06-06
tickets: [KZO-197]
status: scope_locked
scope_locked_at: 2026-06-06
required_reading:
  - docs/004-notes/kzo-197/provider-console-v2/scope-todo-202606041144-provider-console-v2.md
  - docs/004-notes/kzo-197/scope-todo-202606031320-provider-fixer-kr-binding.md
superseded_by: null
---

# Todo: Provider Console UX Pagination And Operation Inspector

> For agents starting a fresh session: read all files listed in `required_reading` before starting implementation.

## Context

This follow-up scope fixes provider console UX bugs observed in dev and locks the desired behavior for pagination, operation inspection, mapping linked context, responsive mappings, and SSE/refresh stability.

## Scope Lock

Locked on 2026-06-06 after grill alignment. Do not expand this todo with new provider lifecycle semantics, new role/permission splits, provider budget/rate-limit changes, or `mapped_pending_rerun`. New findings should become a separate durable todo unless they are required to make the items below work as written.

Current audit status:

- Implementation is present in the active KZO-197 provider guardrails branch.
- Latest implementation commit: `11276d5c fix(providers): KZO-197: submit unresolved filters reliably`.
- Focused API, web component, web typecheck, web build, and targeted OAuth E2E checks were run during implementation.
- Full local repository gates passed on 2026-06-06:
  `npx eslint .`, `npm run typecheck`, `npm run test --prefix apps/web`, `npm run test --prefix apps/api`,
  `npm run test:integration:full:host`, `npm run test:e2e:bypass:mem --prefix apps/web`,
  `npm run test:e2e:oauth:mem --prefix apps/web`, and `npm run test:http --prefix apps/api`.
- After the latest filter-submit regression fix, these focused gates passed:
  `npm run test --prefix apps/web -- AdminProvidersClient.test.tsx`, `npx eslint .`, and `npm run typecheck`.
- Latest commit was pushed to PR #204 and CI run `27049483868` passed.
- Dev deployment run `27049655875` failed in the remote deploy step with exit code `255`; inspect deployment logs before rerunning or validating the latest filter fix on dev.
- Chrome-extension dev validation against commit `7dbe521f` passed for provider status, sub-tab rendering, pagination, direct filtered URLs, select-all behavior, and absence of console errors, but found the unresolved filter Apply/Enter bug fixed by `11276d5c`.

Known code findings from the grill:

- `apps/web/app/admin/providers/page.tsx` currently parses only `unresolvedPage` and `operationsPage`; mappings, incidents, activity, logs, and operation outcomes are fetched at page `1`.
- Several visible `Pagination` controls in `AdminProvidersClient.tsx` are wired to `onPageChange={() => undefined}`.
- Operation outcomes are loaded from the selected/fallback operation on the server, but `View details` only updates local `selectedOperationId`, so outcomes can appear to disappear when another operation is staged or enqueued.
- Mapping linked context pushes route params, but selected operation lookup only searches the currently loaded operations page.
- The mappings table uses `overflow-hidden`, so narrow viewports clip instead of horizontal scrolling.

Latest validation finding:

- Direct unresolved filter URLs worked on dev, but the rendered search form did not submit through Apply/Enter. The fix converts the unresolved filter controls to a real form submit path and adds a component regression test.

## Locked Decisions

- Use URL-backed pagination for every provider console pageable section.
- Keep pagination stable across refresh/SSE and reset only when the result set changes.
- Replace separate `Live progress`, `Operation details`, and `Operation item outcomes` blocks with one selected-operation inspector.
- Keep current operation and selected operation separate.
- Make `Inspect`/details clicks obvious with URL state, selected row highlight, scroll/focus, and user feedback.
- Operation outcomes belong only inside the selected operation inspector.
- Support operation outcome pagination and lightweight state/action filters.
- Support selected operation lookup even when the selected operation is not on the current operations page.
- Add `unresolvedState=all` for list filtering and mapping linked context; default remains `active`.
- Disable bulk repair/select-all matching unless unresolved filter is `active`.
- Add mapping pagination and mapping search.
- Make mappings responsive with desktop horizontal scroll and mobile cards.
- Make linked context clicks useful and never visually no-op.
- Wire incidents, activity, and logs pagination without adding new filters except existing `operationId` for logs.
- Preserve scroll, selected tab, selected operation, and pagination across refresh/SSE; debounce route refreshes.
- After user-created actions, only execute repair should jump to the Operations inspector by default. Row-level renew/rerun/reverify/revert actions should mostly stay in place and expose an Inspect link/toast.

## Implementation Steps

- [x] Extend provider console page query parsing in `apps/web/app/admin/providers/page.tsx` for `mappingsPage`, `incidentsPage`, `activityPage`, `logsPage`, `operationOutcomesPage`, `operationOutcomeState`, `operationOutcomeAction`, `mappingsSearch`, and `unresolvedState=all`.
- [x] Update provider console server fetches so mappings, incidents, activity, logs, and operation outcomes use their own query-backed page params instead of hard-coded `page=1`.
- [x] Update shared/API validation for unresolved list queries to accept `state=all` as a filter value without adding `all` to the persisted lifecycle state enum.
- [x] Update unresolved persistence/API listing so `state=all` omits the state predicate while preserving existing state-specific behavior.
- [x] Add mappings search support in API/persistence for source symbol, resolved/provider symbol, and linked operation ID from evidence where feasible.
- [x] Add selected operation support when `operationId` is outside the current operations page, either via `includeOperationId` on the operations endpoint or a dedicated selected-operation fetch.
- [x] Ensure operations response/page composition can include the selected operation for inspector rendering without corrupting paginated history totals.
- [x] Wire every visible `Pagination` in `AdminProvidersClient.tsx` to a real route update handler; remove any `onPageChange={() => undefined}` placeholders.
- [x] Implement reset rules: reset page to `1` only when provider, relevant filter/search/sort, selected operation for outcomes, or result-set-defining params change.
- [x] Preserve page params on manual refresh and SSE-driven refreshes.
- [x] Debounce provider-console route refreshes caused by SSE/progress events to avoid scroll jumps and UI jitter.
- [x] Redesign the Operations tab to show a compact current-operation banner, paginated operation history table, and a selected-operation inspector below the table.
- [x] Define current operation priority as newest `running`, `paused`, or `preparing_preview`, with `queued` shown only as fallback when no active/preparing operation exists.
- [x] Rename `View details` to `Inspect`, set `operationId` in the URL, highlight the selected operation row, scroll/focus to the inspector, and show feedback so the user knows where details opened.
- [x] Remove duplicated standalone `Live progress` and standalone `Operation item outcomes` sections; render progress, details, scope, and outcomes inside the operation inspector.
- [x] Add operation outcome state/action filters and URL-backed outcome pagination in the inspector.
- [x] Keep selected operation sticky via `operationId`; background-enqueued operations must not steal the selected inspector.
- [x] For user-created execute repair, route to Operations with the new operation selected and inspector focused.
- [x] For renew/rerun/reverify/revert mapping actions, keep the user on the current tab by default and show a toast/action affordance to inspect the created operation.
- [x] Update mapping linked context so `Unresolved: SOURCE` opens `tab=unresolved&unresolvedState=all&unresolvedSearch=SOURCE`.
- [x] Add empty/fallback notices when a mapping linked-context search has no active row or no unresolved row at all.
- [x] Update mapping operation links so they open `tab=operations&operationId=...`, load the selected operation even if off-page, and focus the inspector.
- [x] Add mappings table horizontal scroll for desktop/tablet with a stable min width.
- [x] Add a mobile card layout for mappings with source/provider symbol, resolver, verified time, evidence summary, linked context, and actions.
- [x] Ensure mapping evidence/context text wraps where appropriate while symbols and operation IDs remain monospaced and copyable.
- [x] Wire incidents, activity, and logs pagination with URL params; keep logs `operationId` filtering and reset `logsPage=1` when `operationId` changes.
- [x] Add or update component tests for pagination handlers, operation inspect selection, sticky selected operation behavior, mapping linked context, `unresolvedState=all`, and mappings responsive rendering.
- [x] Add a regression test that the unresolved filter form submits and updates route state.
- [x] Add or update API/integration tests for `state=all`, mappings search, selected operation include/fetch, and operation outcome filters/pagination.
- [x] Add or update E2E coverage for provider console pagination, Inspect flow, mapping linked context, and responsive mappings on desktop/mobile.
- [x] Run the smallest relevant test scope first, then required broader gates for touched areas.
- [ ] Inspect failed dev deployment run `27049655875`, rerun or fix deployment as needed, then validate the latest branch on dev through Chrome.

## Acceptance Criteria

- [x] Clicking `>` on every provider console paginated sub-tab changes the data page and preserves the route state.
- [x] Refresh data and SSE/progress updates do not reset tab, pagination, selected operation, or scroll.
- [x] Clicking `Inspect` visibly selects the operation, scrolls/focuses the inspector, updates the URL, and shows progress/outcomes for that operation.
- [x] New background or queued operations do not replace the selected operation inspector unless the user initiated an action that should select the new operation.
- [x] Operation outcomes remain visible for the selected operation even after another operation is enqueued.
- [x] Operation outcome filters and pagination work independently from operations table pagination.
- [x] Mapping linked context opens meaningful filtered views, including selected operation details for off-page operations.
- [x] Mapping linked context does not silently no-op when no unresolved rows exist; the UI explains the empty/fallback state.
- [x] Mappings pagination and search work.
- [x] Mappings table is usable on narrow desktop/tablet via horizontal scroll and usable on mobile via cards.
- [x] Bulk repair/select-all matching is unavailable when unresolved state is not `active`.

## Out Of Scope

- Adding new incident status filters, log level filters, or activity filters.
- Changing persisted unresolved lifecycle states beyond supporting `all` as a read/filter value.
- Implementing `mapped_pending_rerun`; that belongs to the separate repair lifecycle/data-consistency scope.
- Changing provider budget/rate-limit behavior.
- Changing role/permission model.

## References

- Prior provider console v2 todo: `docs/004-notes/kzo-197/provider-console-v2/scope-todo-202606041144-provider-console-v2.md`
- KR binding todo: `docs/004-notes/kzo-197/scope-todo-202606031320-provider-fixer-kr-binding.md`
- Main web component: `apps/web/components/admin/AdminProvidersClient.tsx`
- Provider console page: `apps/web/app/admin/providers/page.tsx`
- Admin provider routes: `apps/api/src/routes/adminRoutes.ts`
