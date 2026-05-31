---
slug: kzo-132
source: scope-grill
created: 2026-04-01
tickets: [KZO-132]
required_reading: []
superseded_by: null
---

# Todo: KZO-132 — Notification Center + Daily Refresh SSE Handling

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read AGENTS.md and the .claude/rules/ directory for project conventions.

## Design Decisions (locked)

1. **Option B (inline Settings status) + notification badge** — no toast library. Daily refresh status updates Settings page badges in real-time via per-ticker SSE events. A notification bell in AppShell aggregates batch-level summaries.
2. **Database-backed notifications** — backend writes, survives page refresh and browser-closed scenarios.
3. **One notification per daily run, severity-adaptive** — not per-ticker. Severity: info (all success), warning (partial failure), error (all failed). Per-ticker detail in JSONB `detail` column.
4. **Fan-in via `refresh_batches` table** — atomic counter updates, batch-complete triggers aggregated notification write.
5. **Per-user notification filtering** — system-wide batch, but each user's notification reflects only their monitored ticker subset.
6. **Escalation tooltip for failures only** — auto-show tooltip for unread warning/error notifications after hours/days. Not for info-severity. `escalated_at` column prevents re-showing.
7. **No `daily_refresh_started` event** — skipped, daily refresh per-ticker is fast, intermediate badge state not worth the complexity.
8. **Per-ticker SSE events kept alongside summary** — `daily_refresh_complete/failed` feed Settings badges in real-time. `daily_refresh_summary` feeds the notification center.
9. **Open-enum `source` column** — new notification sources require zero migrations.

## Schema

### `refresh_batches` (operational audit log)

```
id              TEXT PK (gen_random_uuid()::text)
user_id         TEXT FK -> users (nullable, ON DELETE SET NULL)
jobs_total      INTEGER NOT NULL, CHECK > 0
jobs_succeeded  INTEGER NOT NULL DEFAULT 0
jobs_failed     INTEGER NOT NULL DEFAULT 0
status          TEXT ('pending'|'running'|'completed'|'failed')
ticker_results  JSONB DEFAULT '{}'
started_at      TIMESTAMPTZ
completed_at    TIMESTAMPTZ (nullable)
created_at      TIMESTAMPTZ
```

Indexes: `created_at DESC`, `(user_id, created_at DESC) WHERE user_id IS NOT NULL`, `(status) WHERE status IN ('pending','running')`

### `notifications` (user-facing, extensible)

```
id              TEXT PK (gen_random_uuid()::text)
user_id         TEXT NOT NULL FK -> users (ON DELETE CASCADE)
severity        TEXT ('info'|'warning'|'error')
source          TEXT NOT NULL (open enum: 'daily_refresh', future: 'backfill', 'recompute'...)
source_ref      TEXT (nullable, points to source record e.g. batch id)
title           TEXT NOT NULL
body            TEXT (nullable)
detail          JSONB (nullable, per-source structured payload)
read_at         TIMESTAMPTZ (NULL = unread)
escalated_at    TIMESTAMPTZ (NULL = tooltip not yet shown)
dismissed_at    TIMESTAMPTZ (soft delete)
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

Indexes (partial):
- `(user_id, created_at DESC) WHERE read_at IS NULL AND dismissed_at IS NULL` — unread dropdown
- `(user_id, created_at DESC) WHERE dismissed_at IS NULL` — all notifications paginated
- `(user_id, created_at DESC) WHERE read_at IS NULL AND dismissed_at IS NULL AND escalated_at IS NULL AND severity IN ('warning','error')` — escalation candidates
- `(source, created_at DESC)` — source-based lookup

## Implementation Steps

### Phase 1: Schema + Backend Infrastructure

- [ ] 1. Migration 023 — `refresh_batches` + `notifications` tables with indexes and constraints
- [ ] 2. Shared types: `DailyRefreshSummaryEvent` in `libs/shared-types/src/events.ts`, add to discriminated union
- [ ] 3. Shared types: notification DTOs in `libs/shared-types/src/index.ts` — `NotificationDto`, `NotificationListResponse`, `UnreadCountResponse`
- [ ] 4. Shared types: update `BackfillJobData` with optional `batchId?: string`
- [ ] 5. Persistence interface: add notification + batch methods to `Persistence` type — `createNotification`, `getNotificationsForUser`, `getUnreadCount`, `markNotificationRead`, `markAllRead`, `dismissNotification`, `createRefreshBatch`, `updateBatchTickerResult`, `getActiveBatch`
- [ ] 6. Postgres persistence implementation for notification + batch methods
- [ ] 7. Notification service: batch-complete handler — query users with monitored tickers, filter `ticker_results` per user, derive severity, write per-user notification, emit `daily_refresh_summary` SSE event

### Phase 2: Backend Routes + Worker Changes

- [ ] 8. Notification CRUD routes: `GET /notifications` (paginated), `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id` (dismiss)
- [ ] 9. Update `enqueueDailyRefresh` — create `refresh_batches` row, pass `batchId` in each job's data
- [ ] 10. Update `backfillWorker` — on daily refresh job completion (success or last-retry failure), update batch counter + `ticker_results` via atomic UPDATE...RETURNING. On fan-in complete (`succeeded + failed = total`), trigger notification write + SSE summary event
- [ ] 11. Wire notification routes into `registerRoutes.ts`

### Phase 3: Frontend — Notification Center

- [ ] 12. Notification bell component in AppShell header — icon, unread count badge, red dot for unread
- [ ] 13. Notification dropdown component — list of notifications with severity icons, title, timestamp, mark-as-read on click
- [ ] 14. `useNotifications` hook — fetch notifications, unread count, mark-read mutations, poll or SSE-driven refresh
- [ ] 15. `useEventStream` handler for `daily_refresh_summary` — trigger notification refetch on event
- [ ] 16. Escalation tooltip logic — on page load, check for unread warning/error older than threshold, show tooltip if not yet escalated, PATCH `escalated_at`
- [ ] 17. i18n dictionary entries for notification strings (title templates, body templates, severity labels)

### Phase 4: Frontend — Settings Page SSE Wiring

- [ ] 18. Wire `daily_refresh_complete/failed` per-ticker events into `useMonitoredTickers.ts` (matching existing backfill event handler pattern)

### Phase 5: Tests

- [ ] 19. Unit tests (vitest): notification service logic, batch fan-in counter behavior, severity derivation, per-user ticker result filtering
- [ ] 20. Integration tests: notification CRUD endpoints (create, list, mark-read, dismiss), batch lifecycle (create -> ticker results -> completion -> notification), fan-in atomicity
- [ ] 21. E2E AAA tests (bypass mode): bell icon visibility, dropdown open/close, unread badge count, mark-as-read interaction, notification appears after simulated daily refresh
- [ ] 22. E2E OAuth tests: notification endpoints return 401 without session
- [ ] 23. API HTTP tests (Playwright): notification CRUD with auth, pagination, read/unread state transitions, dismiss
- [ ] 24. Lint + typecheck pass across all workspaces

### Phase 6: Cleanup

- [ ] 25. Verify all 7 test suites pass (lint, typecheck, web unit, integration, E2E bypass, E2E OAuth, API HTTP)
- [ ] 26. Create follow-up tickets for out-of-scope items

## Open Items

- [ ] Escalation timeout values — how many hours/days before tooltip shows for warning vs error? (Can default to 24h warning, 1h error and adjust later)
- [ ] Notification retention policy — how long to keep dismissed/read notifications? (Can defer, no urgency)

## Follow-Up Tickets to Create (out of scope)

1. Wire backfill failures into notification center as `source: 'backfill'`
2. Wire recompute failures into notification center as `source: 'recompute'`
3. Notification preferences UI (mute by source, snooze escalation)
4. Email digest of unread failure notifications

## References

- Linear ticket: [KZO-132](https://linear.app/kzokv/issue/KZO-132)
- Blocked by: [KZO-130](https://linear.app/kzokv/issue/KZO-130) (merged)
- SSE event types: `libs/shared-types/src/events.ts`
- Existing backfill SSE handler: `apps/web/features/settings/hooks/useMonitoredTickers.ts`
- useEventStream hook: `apps/web/hooks/useEventStream.ts`
- Backfill worker: `apps/api/src/services/market-data/backfillWorker.ts`
- Daily refresh enqueue: `apps/api/src/services/market-data/dailyRefreshEnqueue.ts`
- Settings UI: `apps/web/features/settings/components/MonitoredTickersSection.tsx`
