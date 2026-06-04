---
slug: kzo-197-provider-console-v2
source: scope-grill
created: 2026-06-04
tickets: [KZO-197]
required_reading:
  - docs/004-notes/kzo-197/scope-todo-202605091500-locked.md
  - docs/004-notes/kzo-197/scope-todo-202606031320-provider-fixer-kr-binding.md
  - docs/004-notes/kzo-197/provider-console-v2/mockups/provider-console-v2-mockup.html
superseded_by: null
---

# Todo: KZO-197 Provider Console V2

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This v2 scope supersedes the standalone Provider Fixer UI direction and keeps the work versioned under `docs/004-notes/kzo-197/provider-console-v2/`.

## Locked Product Direction

- Replace `/admin/providers` with a unified provider operations console.
- Retire the standalone `/admin/provider-fixer` route before rollout; no redirect or compatibility page is required because that route has not shipped.
- Ship as one large PR with separate ordered commits.
- Do not feature-flag the replacement.
- Keep current admin roles. All admins can perform provider operations, guarded by preview, confirmation, typed phrase, and audit trails where applicable.
- Make provider actions capability-driven across Yahoo, FinMind, Twelve Data, Frankfurter, and ASX GICS CSV.
- Use SSE for live operation progress and invalidation, while API refetches remain the source of truth.

## Information Architecture

- Provider rail is grouped by domain: KR market data, TW market data, US market data, AU market data, FX.
- Each provider owns the same sub-tabs: Overview, Unresolved instruments, Fixer, Operations, Incidents, Activity, Logs, Mappings.
- Unsupported tabs/actions remain visible but disabled with provider-specific reasons.
- Desktop uses a left provider rail and dense tables. Mobile uses a provider selector, sticky status summary, cards, action sheets, and full-screen destructive previews.

## Data Model And Backend Decisions

- Add durable `provider_unresolved_items`; active counts come from this table, not raw error trails.
- Keep `provider_error_trail` as raw occurrence history.
- Add durable `provider_incidents` with lifecycle: `open`, `acknowledged`, `resolved`, `ignored`.
- Add item-level operation outcomes with states: `pending`, `running`, `succeeded`, `failed`, `skipped`, `rate_limited`, `cancelled`.
- Add durable provider mappings where supported, especially Twelve Data catalog identity to Yahoo Finance KR provider symbol.
- Add `unsupported` unresolved-item state with required reason/evidence.
- Normalize item-scoped provider errors into unresolved items/incidents at error-write time through a central service. Backfill only seeds old data.

## Operation Semantics

- All provider writes go through the operation engine, including small writes.
- Long-running and write operations execute as background jobs, not HTTP request bodies.
- Progress is `processed / total`, where processed is durable item outcomes: `succeeded + failed + skipped + cancelled`.
- Rate-limit pause auto-resumes as `paused_rate_limit`; manual pause remains `paused_manual`; non-rate-limit failure becomes `paused_error`.
- Cancel is terminal for the operation and does not roll back completed item work.
- Retry creates a linked new operation and does not mutate the historical operation.
- Shared-budget queues serialize budget-consuming operations; per-provider write locks serialize Repair/Rerun/Revert.

## Guardrails

- Read-only refresh has no two-gate guardrail.
- Small writes use checkbox confirmation.
- Bulk, destructive, or dangerous writes require preview plus typed phrase.
- Purge logs and bulk revert always require typed phrase.
- Preview stores scope filters, match count, snapshot hash, estimated API calls/writes/enqueues, sample rows, and confirmation phrase.
- Execute fails with `snapshot_changed` if the preview scope materially changed.

## Provider Actions

- Shared taxonomy: `renew_evidence`, `repair_mapping`, `rerun_backfill`, `reverify_mapping`, `revert_mapping`, `purge_logs`, `normalize_errors`, `refresh_health`.
- Repair binds provider symbols or fixes supported mapping classes.
- Renew refreshes evidence/candidates and does not write mappings or bars.
- Rerun fetches fresh provider data for already resolved mappings or known provider symbols.
- Rerun is disabled until selected rows are resolved or durably mapped.
- Quote-first and chart-probe are evidence strategies, not confusing standalone page modes.
- KR ambiguous candidates require admin selection before Repair.
- Twelve Data plan limits become explicit unsupported/capability evidence, not endless unresolved loops.
- Cross-provider fallback guidance is allowed, but provider switching requires explicit admin action.

## Admin Settings

- Add Admin Settings tab `Provider operations`.
- Settings split into global defaults, shared budget groups, and provider overrides.
- Operation budgets are API-authoritative and UI-prevalidated.
- Editable operation budget must be greater than zero and below the effective upstream budget when one exists.
- Shared budgets are shown for FinMind TW/US and Twelve Data AU/KR.
- Configurable values include guardrail thresholds, operation pacing, auto-renew, incident recurrence window, health thresholds, stale heartbeat thresholds, and retention.
- Retention configs include operation summaries, operation logs, incidents, and resolved unresolved items.

## Activity, Logs, And Purge

- Incidents are durable lifecycle objects.
- Activity is provider-scoped and composed from structured sources.
- Logs are raw/system records and include the purge surface.
- Purge can delete provider error trail and provider operation logs only.
- Purge cannot delete incidents, unresolved items, mappings, operation summaries, audit logs, or pg-boss history.

## Acceptance Criteria

- `/admin/providers` renders the provider console with grouped provider tabs and provider-owned sub-tabs.
- Standalone `/admin/provider-fixer` is removed before rollout.
- Yahoo KR unresolved counts update from durable unresolved items after Repair.
- Rerun is disabled until rows are resolved or mapped, with clear tooltip/inline reason.
- Normal safe actions remain in Fixer; dangerous/bulk work uses preview and staged operation controls.
- Running operations show live progress through SSE and persisted counters.
- Admins can inspect unresolved rows, operation item outcomes, mappings, incidents, activity, logs, and provider settings.
- Provider operations settings enforce budgets, retention, thresholds, and shared-budget constraints.
- Purge logs is available with preview and typed confirmation.
- Desktop and mobile views are usable and accessible.

## Mockups

The comprehensive mockup set is in `mockups/screenshots/`.

- `01-provider-console-overview-desktop.png` - grouped provider console and health overview.
- `02-unresolved-instruments-desktop.png` - unique unresolved table, filters, bulk selection, disabled Rerun reason.
- `03-provider-fixer-desktop.png` - provider-owned Fixer tab with Renew/Repair/Rerun semantics.
- `04-dangerous-preview-desktop.png` - destructive/bulk preview with typed phrase and snapshot guard.
- `05-operations-running-desktop.png` - live operation progress, SSE state, budget wait, counters.
- `06-operation-outcomes-desktop.png` - item-level operation outcomes and retryable failures.
- `07-incidents-activity-logs-desktop.png` - useful incidents/activity/log surfaces, not audit-log dead ends.
- `08-kr-mappings-desktop.png` - durable KR mappings and evidence.
- `09-provider-operations-settings-desktop.png` - Admin Settings provider operations tab.
- `10-mobile-unresolved.png` - mobile provider selector and unresolved cards.
- `11-mobile-dangerous-preview.png` - mobile destructive preview sheet.

## Implementation Steps

### Progress Snapshot

- 2026-06-04: Created versioned v2 mockup folder with 11 rendered desktop/mobile screenshots and a deterministic Playwright renderer.
- 2026-06-04: Started the web replacement slice: `/admin/providers` now fetches provider health plus fixer summary/diagnostics/operations/logs, renders the grouped provider rail and provider-owned subtabs, removes the unshipped `/admin/provider-fixer` page route, and updates provider-console unit/E2E expectations.
- 2026-06-04: Added direct tab/help titles, notification-aware Refresh data feedback, disabled Rerun reasons, and dangerous-operation confirmation controls in the provider console shell.
- Remaining high-risk work is still backend-heavy: durable unresolved items/incidents/outcomes, provider-scoped API routes, background operation engine, KR resolver binding, provider settings, purge preview, full mobile action sheets, and full gate coverage.

- [ ] Add migrations for `provider_unresolved_items`, `provider_incidents`, provider mappings, provider operation outcomes, operation summary fields, settings, and supporting indexes.
- [ ] Add idempotent migration/backfill from recent `provider_error_trail` into unresolved items/incidents.
- [ ] Add central provider-error normalization service and wire item-scoped provider error writers/workers to it.
- [ ] Add provider capability registry and shared operation taxonomy.
- [ ] Implement provider operation engine with background execution, row outcomes, pause/resume/cancel/retry, stale operation cleanup, queueing, budget pacing, and SSE emission.
- [ ] Add API-authoritative Provider operations settings validation for guardrails, budgets, thresholds, retention, and auto-renew.
- [ ] Add provider-scoped API routes under `/admin/providers/:providerId/*` for console, unresolved items, incidents, activity, logs, mappings, operation preview, operation execute, operation control, and purge.
- [ ] Remove the unshipped `/admin/provider-fixer` UI route and old fixer-only assumptions.
- [ ] Implement KR resolver binding: Twelve Data catalog identity plus market evidence to verified Yahoo Finance KR provider symbol.
- [ ] Update Yahoo Finance KR provider to consult durable mappings before fallback probing.
- [ ] Implement Renew, Repair, Rerun, Reverify, Revert, Unsupported, Ignore, Reopen, and Purge flows through the operation engine where writes occur.
- [ ] Build `/admin/providers` provider console shell with grouped provider rail, provider sub-tabs, Overview, Unresolved instruments, Fixer, Operations, Incidents, Activity, Logs, and Mappings.
- [ ] Build dense unresolved tables with filters, sort, pagination, select-all-matching, row/bulk actions, disabled-action reasons, and recently resolved visibility.
- [ ] Build operation details with durable item outcomes, progress, budget state, pause/resume/cancel/retry, and links to incidents/unresolved items/logs.
- [ ] Build mappings tab with evidence, reverify, revert mapping, linked unresolved item, linked operation, and unsupported empty states for providers without mappings.
- [ ] Build logs purge preview modal and provider-scoped Activity timeline.
- [ ] Build Admin Settings Provider operations tab with global defaults, shared budget groups, provider overrides, validation, and retention settings.
- [ ] Add mobile provider selector, mobile cards, bottom action bar, disabled action reasons, and full-screen destructive preview sheets.
- [ ] Add concise contextual help/tooltips for Repair, Renew, Rerun, Purge, quote-first, chart-probe, awaiting action, unsupported actions, and disabled states.
- [ ] Add DB/API/worker tests for unresolved dedupe, incident recurrence, operations, outcomes, queueing, rate-limit pause/resume, stale operations, guardrails, settings validation, purge, and KR mapping.
- [ ] Add web unit tests for provider console UI states, action enablement, tooltips/help copy, mobile variants, and settings validation.
- [ ] Run `/aaa` to add or update E2E tests covering provider console navigation, unresolved table, repair flow, dangerous preview, operations progress, purge guardrail, and mobile action sheet.
- [ ] Run the smallest relevant tests first, then the repo-required full gate before PR.

## Commit Order

1. Schema, models, settings, capability registry.
2. Operation engine, outcomes, budgets, SSE.
3. Provider-scoped APIs and old fixer removal.
4. KR resolver mapping fixes.
5. Provider console UI shell and tabs.
6. Unresolved, Fixer, and Operations UX.
7. Incidents, Activity, Logs, and Settings UX.
8. Tests, mobile polish, copy, and tooltips.

## Out Of Scope

- Separate provider-operation permissions.
- Auto-repair without admin confirmation.
- Auto-switching providers without explicit admin action.
- Feature flag for the new provider console.
- Keeping the unshipped `/admin/provider-fixer` page alive.
