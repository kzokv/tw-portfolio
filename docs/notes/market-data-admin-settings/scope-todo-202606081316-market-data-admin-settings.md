---
slug: market-data-admin-settings
source: scope-grill
created: 2026-06-08
tickets: []
required_reading: []
superseded_by: docs/notes/market-data-admin-settings/scope-todo-202606231449-refresh-market-data-operations.md
---

# Todo: Market Data Admin Settings

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [ ] Add typed provider request pacing settings, bounds, shared DTO fields, patch schema support, memory/Postgres persistence, and DB migration.
- [ ] Add Admin Settings rows for provider pacing with localized copy and clear "enforced by Yahoo KR resolver now" wording.
- [ ] Enforce Yahoo KR request pacing in admin resolver operation flows: resolve, renew, reverify.
- [ ] Surface effective Yahoo KR pacing in KR resolver start flow, operation history, and inspector.
- [ ] Add shared Market Data operations API shape with structured summaries and sanitized metadata.
- [ ] Replace KR-only/generic operations split with shared operation history and inspector shell.
- [ ] Redesign operation history filters, chronological selection behavior, pagination, and row preview.
- [ ] Redesign inspector summary, structured details, outcomes/logs, and sanitized debug sections.
- [ ] Add Market Data Admin i18n namespace and wire all Market Data strings.
- [ ] Fix instruments responsive filter/action layout.
- [ ] Disable unsupported purge categories with localized reasons and add purge execute success notice.
- [ ] Add focused API, persistence, and unit coverage.
- [ ] Run `/aaa` to add or update E2E tests covering disabled purge categories, purge notice, operations inspection, row ordering, filters, and Yahoo KR pacing visibility.

## Open Items

- [ ] Optional only if cheap and low-risk: add jump-to-selected operation page support.
- [ ] Optional only if cheap and low-risk: add a small auto-resume safety-net after Yahoo KR pacing is enforced.

## Locked Decisions

- One big PR is allowed, with internal rooms for UI correctness, operations API/DTO enrichment, operations UX redesign, Yahoo KR pacing, and testing/auditability.
- Market Data Admin gets full i18n coverage; unrelated admin pages stay out of scope.
- Purge categories remain visible when unsupported, but disabled with localized reasons and auto-deselected when market changes.
- Operations uses one shared shell across all markets, with provider-specific detail sections where available.
- Desktop operations layout uses history plus a sticky right inspector; mobile uses drawer or collapsible detail behavior.
- Selected operations are highlighted in chronological order and are not pinned to the top.
- Operation history includes structured filters and text search.
- Operation previews are localized by the frontend from structured backend summaries.
- Inspector includes summary, structured details, outcomes/logs, and sanitized allowlisted debug metadata.
- Generic typed provider pacing settings are added for all provider families, but only Yahoo KR admin resolver operation flows enforce pacing in this PR.
- Full auto-resume is out of required scope.
- API normalizes operations at the boundary; backend storage models are not unified.

## Out Of Scope

- Broader admin redesign outside Market Data.
- Dynamic provider config framework.
- Global toast system.
- Non-Yahoo-KR pacing enforcement.
- Full auto-resume scheduler or retry policy.
- Backend storage-model unification.

## References

- Worktree: `/Users/lume/repos/tw-portfolio/.claude/worktrees/market-data-admin-settings`
- Mockup: `docs/notes/market-data-admin-settings/operations-layout-mockup.html`
