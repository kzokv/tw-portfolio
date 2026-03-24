# Technical Writer Memory — KZO-113

## Session: 2026-03-24

### What was documented

**KZO-113: Generic SSE Infrastructure with Redis Pub/Sub Bridge**

All 5 test suites passed. Convergence exited at iteration 2.

#### Changes made

1. **`docs/004-notes/004-transaction-mutations/003-kzo-113-scope-todo.md`**
   - Marked all implementation checkboxes `[x]`
   - Marked all 3 Open Items `[x]` with resolution notes (retry budget = 5, logging = Fastify default, heartbeat/gap = acceptable for phase 1)

2. **`docs/004-notes/004-transaction-mutations/README.md`**
   - Added "KZO-113 Implementation Status" section with:
     - Complete status note
     - What-was-built summary (EventBus, app lifecycle, event types, SSE route, synthetic endpoint, frontend hook)
     - Key design decisions (connection limit 200+SSE, no replay, heartbeats carry id:)

3. **`docs/001-architecture/backend-db-api.md`** (evergreen)
   - Added "Server-Sent Events" endpoint section before "AI transaction endpoints"
   - Added `GET /events/stream` to the web-consumed API surface list
   - Added `POST /__test/publish-event` to the "not currently called" routes list

#### Stale reference search results
- Only `resolveApiBase` mention in docs: `docs/004-notes/003-oauth-env-refactor/003-auth-flow-design-review.md:279` — this is a **frozen snapshot**, left unchanged per doc-management rules.
- No stale `AppInstance`, `EventBus`, or SSE references found in evergreen docs (none existed before this ticket).

### Patterns to remember
- Frozen snapshots (`docs/004-notes/`) should never be updated post-merge; the exception for the scope-todo is only valid pre-merge.
- The backend-db-api.md endpoint catalog is the authoritative evergreen list of API routes — always update it when new routes land.
