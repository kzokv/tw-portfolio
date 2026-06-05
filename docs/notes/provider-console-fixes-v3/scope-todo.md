---
slug: provider-console-fixes-v3
source: scope-grill
created: 2026-06-05
tickets: [KZO-197]
required_reading: []
superseded_by: null
---

# Todo: Provider Console Fixes V3

> For agents starting a fresh session: use this todo as the locked scope. The `active` unresolved-item state stays unchanged in DB, API, shared types, and visible UI.

## Locked Scope

1. Keep provider unresolved item state as `active` everywhere, including UI labels and filters.
2. Replace decorative unresolved-table checkboxes with real local selection state.
3. Header checkbox selects or clears only visible page rows.
4. Add a separate all-matching selection action for the current provider/error/state/search filter.
5. Preserve selection across SSE refresh only when the provider and filter fingerprint are unchanged.
6. Clear selection when provider, resolver mode, error code, state, search, sort, or scope changes.
7. Make `Repair selected` disabled until a concrete selected scope exists.
8. Remove the top-level header `Repair selected` action from the page header.
9. Add a shared repair scope panel showing provider, error code, state/search filter, scope type, count, resolver mode, guardrail level, and preview status.
10. Use durable provider unresolved items as the repair and renew scope source, not raw provider error trail rows.
11. Show raw error occurrences separately from unique active unresolved instruments where diagnostics need both.
12. Support selected-items scope using full row identity: `providerId`, `marketCode`, `errorCode`, and `sourceSymbol`.
13. Support filter scope for all-matching actions using provider, market, error code, `state: "active"`, and optional search.
14. Freeze scope metadata at preview creation and execute only from the frozen operation.
15. Use scope-aware confirmation phrases for repair, for example `EXECUTE 10 SELECTED` and `EXECUTE 27212 MATCHING`.
16. Use agreed bulk state confirmation phrases: `MARK 10 UNSUPPORTED`, `IGNORE 10 ACTIVE`, `MARK 27212 MATCHING UNSUPPORTED`, and `IGNORE 27212 MATCHING ACTIVE`.
17. Single-row repair still uses preview; below the dangerous threshold it can be checkbox-only.
18. Row `Renew` creates a row-scoped operation.
19. Row `Repair` creates a row-scoped preview.
20. Bulk `Renew` uses budget-sensitive guardrails: lightweight for single-row, preview/acknowledgement for multi-row, typed phrase for large all-matching budget risk.
21. Bulk selection supports repair, renew, mark unsupported, ignore, export, and clear selection.
22. Bulk rerun is out of scope for this pass.
23. For all-matching or large state changes, require preview and typed confirmation above threshold.
24. Add async large preview using `preparing_preview`; small selected previews may remain synchronous.
25. `preparing_preview` appears immediately in Fixer and can be cancelled.
26. Only one active operation per provider and market is allowed across `preparing_preview`, `preview`, `queued`, `running`, and `paused`.
27. Different-scope active operations require explicit cancel or replace.
28. Large preview preparation must use stored unresolved evidence/sample first and avoid upstream provider verification.
29. Repair execution verifies each scoped unresolved item, writes only verified mappings, marks applied rows resolved, enqueues KR rerun/backfill for mapped rows, and leaves skipped/failed rows active with outcome reason.
30. Provider console UI scaffolding is provider-general, while actual mapping repair execution remains KR-only unless another provider already supports it.
31. Providers without repair still support row selection for supported actions and show provider-specific disabled reasons.
32. Existing ambiguous preview operations are shown as legacy previews and require a new scoped preview before execution.
33. Preview expiration is visible in the preview card and execute checklist.
34. Snapshot drift blocks execute and prompts the admin to refresh preview.
35. Execute button uses a visible blocker checklist covering token validity, operation selection, scope match, checkbox acknowledgement, typed phrase, preview expiry, and executability.
36. Operations tab becomes an audit/control center. Rename `Select` to `View details`.
37. Fixer and Operations both show progress, using a shared operation progress component with context-specific copy.
38. Publish provider operation progress over SSE at most once per second per operation, plus lifecycle events.
39. SSE refresh must preserve scroll and local interaction state.
40. Use `router.push(..., { scroll: false })` for provider console tab/filter/operation URL changes.
41. Incidents and Activity must wrap long text on desktop and render readable mobile layouts.
42. Use hybrid table/card responsive layouts for high-text provider console tabs.
43. Provider fixer API errors should be typed and mapped to UI next-action copy instead of generic `internal_error`.
44. Preview copy must explain that sample rows are display-only and execution applies to the frozen selected or all-matching scope.
45. Create focused mockup screenshots under `docs/mockups/provider-console-v3/`.
46. Implement in separate in-order commits.
47. Ignore the failed dev deploy during this scope; deployment investigation is not a scoped deliverable.

## Out Of Scope

- Renaming `active` state.
- Provider-fixer route resurrection or old provider-fixer UI compatibility.
- Paste-symbol repair scope.
- Bulk rerun for resolved or mapped rows.
- KR resolver algorithm tuning beyond using durable unresolved scope.
- Production repair execution.
- Dev deploy failure investigation.
- New admin roles or permission split.

## Implementation Steps

- [x] Update shared provider operation/unresolved DTOs for selected-items and filter scope payloads.
- [x] Add API validation schemas for scoped preview, renew, repair, and bulk state changes.
- [x] Change provider fixer preview/repair scope source from raw error trail rows to durable provider unresolved items.
- [x] Store frozen scope metadata on provider operations, including scope type, filter fingerprint, selected item identities, match count, snapshot hash, and confirmation phrase.
- [x] Add `preparing_preview` operation phase and migration/type updates.
- [x] Implement async large preview preparation with cancellation checks and one-active-operation-per-provider-market enforcement.
- [x] Keep small selected previews synchronous when they are below the configured threshold.
- [x] Implement row-scoped and selected-scope renew operations with budget-sensitive guardrails.
- [x] Implement selected/all-matching bulk state changes for unsupported and ignored with the agreed confirmation phrases.
- [x] Mark legacy preview operations and prevent new UI execution until a scoped preview is created.
- [x] Add typed API errors for preview timeout/large async fallback, provider rate limit, snapshot drift, token expiry, not executable, active operation conflict, unsupported capability, and stale legacy preview.
- [x] Publish throttled `provider_operation_progress` SSE snapshots at most once per second per operation, plus lifecycle events.
- [x] Update provider console data loading to preserve scroll and local state across SSE refresh.
- [x] Implement local unresolved row selection state, visible-page select-all, all-matching mode, filter fingerprint invalidation, and selection banner states.
- [x] Wire row Renew and Repair buttons to row-scoped operations/previews.
- [x] Wire selected Repair/Renew/Unsupported/Ignore/Export/Clear actions and provider capability disabled reasons.
- [x] Remove the page-header `Repair selected` action.
- [x] Add the shared repair scope panel for Unresolved and Fixer.
- [x] Add explicit Fixer scope selection for direct Fixer entry, with no silent default to all matching.
- [x] Add execute blocker checklist and visible preview expiry status.
- [x] Rename Operations table action from `Select` to `View details` and make the selected operation details/progress panel clearly connected.
- [x] Add shared operation progress UI for Fixer and Operations.
- [x] Make Incidents, Activity, Outcomes, and Logs wrap long text and use mobile card layouts where needed.
- [x] Create focused mockup screenshots in `docs/mockups/provider-console-v3/` for the eight locked states.
- [x] Add or update web component tests for selection state, header checkbox behavior, row actions, banner copy, execute blockers, and responsive rendering.
- [x] Add or update API integration tests for selected-items scope, filter scope, frozen snapshot, confirmation phrases, async preview phase, active operation conflict, bulk state changes, progress events, and typed errors.
- [x] Add or update focused E2E tests for KR unresolved selection to preview, execute guardrails, operations progress, stale preview handling, and responsive provider console tabs.
- [x] Run the smallest relevant tests first, then the repo-required gates for the touched areas.

## Acceptance Criteria

- [x] Header checkbox selects and unselects visible rows only.
- [x] Selection banner count always matches actual selected scope.
- [x] Row Renew, Repair, Ignore, Unsupported, Reopen, and Rerun either work or show a specific disabled reason.
- [x] Repair cannot preview without an explicit selected or all-matching scope.
- [x] All-matching preview clearly states execution applies to all matching rows, not only sample rows.
- [x] Large all-matching preview returns quickly by entering `preparing_preview` instead of blocking.
- [x] Execute button shows exact blocker checklist.
- [x] Progress updates through SSE without scrolling the page to top.
- [x] Incidents and Activity wrap long text on desktop and are readable on mobile.
- [x] Focused component, API, and E2E tests pass.

## Mockup Screenshots To Generate

- [x] `docs/mockups/provider-console-v3/01-unresolved-no-selection-desktop.png`
- [x] `docs/mockups/provider-console-v3/02-unresolved-visible-selected-desktop.png`
- [x] `docs/mockups/provider-console-v3/03-unresolved-all-matching-desktop.png`
- [x] `docs/mockups/provider-console-v3/04-fixer-no-scope-desktop.png`
- [x] `docs/mockups/provider-console-v3/05-fixer-preparing-preview-desktop.png`
- [x] `docs/mockups/provider-console-v3/06-fixer-preview-checklist-desktop.png`
- [x] `docs/mockups/provider-console-v3/07-operations-live-progress-desktop.png`
- [x] `docs/mockups/provider-console-v3/08-unresolved-selection-mobile.png`

## References

- Existing provider console component: `apps/web/components/admin/AdminProvidersClient.tsx`
- Provider console page loader: `apps/web/app/admin/providers/page.tsx`
- Provider admin API routes: `apps/api/src/routes/adminRoutes.ts`
- Shared provider DTOs: `libs/shared-types/src/index.ts`
