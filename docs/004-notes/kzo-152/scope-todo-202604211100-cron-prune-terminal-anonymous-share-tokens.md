---
slug: kzo-152
source: scope-grill
created: 2026-04-21
tickets: [KZO-152]
required_reading: []
superseded_by: null
---

# Todo: KZO-152 — Cron: prune terminal `anonymous_share_tokens` rows older than 90 days

> **For agents starting a fresh session:** read the Linear ticket (KZO-152) and this file in full before starting. The related KZO-147 scope-todo at `docs/004-notes/kzo-147/scope-todo-202604181855-anonymous-share-tokens.md` is background (locked behavior for the token table that this ticket must preserve).

## Context

KZO-147 shipped anonymous share tokens with a 30-day UI retention window (terminal tokens visible to the owner for 30 days past termination) but no DB-level purge. Under continuous use the table grows unbounded. This ticket adds a daily pg-boss cron that deletes terminal rows whose **terminality** (revocation or expiration, whichever applies) is older than a configurable threshold (default 90 days). The 90-day cutoff is always ≥ the 30-day UI window, preserving the owner-visibility guarantee by construction.

## Locked decisions (scope-grill 2026-04-21)

1. **Retention yardstick = terminality, not `created_at`.** Fixes a silent bug in the ticket's literal SQL where a recently-revoked long-lived token would be deleted immediately.
2. **Persistence interface method** `purgeTerminalAnonymousShareTokens(olderThanMs: number): Promise<number>` — Postgres DELETE, Memory returns 0.
3. **pg-boss cron** `0 4 * * *` daily, `policy: "singleton"`, inherits `DEFAULT_MARKET_DATA_QUEUE_OPTIONS`.
4. **Worker file** `apps/api/src/services/registerAnonymousShareTokenPurgeWorker.ts`; queue `"anonymous-share-token-purge"`; verb `purge`.
5. **Env var** `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS`, Zod `int().min(30).default(90)` — schema-level invariant enforcement.
6. **Tests** = Postgres integration + memory no-op `it` in one file + handler unit test.
7. **Observability** = structured log only; no audit entry.
8. **Handler shape** — `cutoffMs` injected via deps; env→ms conversion in `pgBoss.ts` at registration.

## Implementation Steps

### 1 — Env schema
- [ ] Add `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS: z.coerce.number().int().min(30).default(90)` to `libs/config/src/env-schema.ts` immediately after the `ANONYMOUS_SHARE_RATE_LIMIT_*` block.
- [ ] Comment above the entry: "Daily purge retention for terminal anonymous_share_tokens. Must be ≥ 30 (ANONYMOUS_SHARE_TOKEN_RETENTION_MS in days) to preserve the UI visibility guarantee."
- [ ] Rebuild `@tw-portfolio/config` so `apps/api` sees the new field.

### 2 — Persistence interface
- [ ] Add to `apps/api/src/persistence/types.ts`:
      ```ts
      /**
       * Delete terminal (revoked or expired) anonymous_share_tokens whose
       * terminality is older than `olderThanMs`. Returns the number of rows
       * deleted. Memory backend is a no-op (returns 0).
       */
      purgeTerminalAnonymousShareTokens(olderThanMs: number): Promise<number>;
      ```

### 3 — Postgres implementation
- [ ] In `apps/api/src/persistence/postgres.ts`, add a method on `PostgresPersistence` near the other `*AnonymousShareToken*` methods:
      ```sql
      DELETE FROM anonymous_share_tokens
      WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 || ' milliseconds')::interval)
         OR (revoked_at IS NULL AND expires_at < NOW() - ($1 || ' milliseconds')::interval)
      ```
      Use a parameterised interval to avoid SQL injection risk. Return `result.rowCount ?? 0`.

### 4 — Memory no-op
- [ ] In `apps/api/src/persistence/memory.ts` add:
      ```ts
      async purgeTerminalAnonymousShareTokens(_olderThanMs: number): Promise<number> {
        return 0;
      }
      ```

### 5 — Worker file
- [ ] Create `apps/api/src/services/registerAnonymousShareTokenPurgeWorker.ts`:
      - Export constants: `ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE = "anonymous-share-token-purge"`, `ANONYMOUS_SHARE_TOKEN_PURGE_CRON = "0 4 * * *"`.
      - Export `AnonymousShareTokenPurgeDeps` with `persistence: Pick<Persistence, "purgeTerminalAnonymousShareTokens">`, `cutoffMs: number`, `log: FastifyBaseLogger`.
      - Export `createAnonymousShareTokenPurgeHandler(deps)` — calls `persistence.purgeTerminalAnonymousShareTokens(cutoffMs)`; logs `anonymous_share_token_purge_completed` on success with `{ deleted, cutoffMs }`; logs `anonymous_share_token_purge_failed` and rethrows on error (for pg-boss retry).
      - Export `registerAnonymousShareTokenPurgeWorker(app, boss, deps)` — `createQueue` with `{...DEFAULT_MARKET_DATA_QUEUE_OPTIONS, policy: "singleton"}`, then `boss.work` with `{ batchSize: 1, includeMetadata: true }`.

### 6 — pg-boss registration
- [ ] In `apps/api/src/plugins/pgBoss.ts`:
      - Import the new constants and register function.
      - Compute `purgeCutoffMs = Env.ANONYMOUS_SHARE_TOKEN_PURGE_DAYS * 24 * 60 * 60 * 1000`.
      - Call `registerAnonymousShareTokenPurgeWorker(app, boss, { persistence: app.persistence, cutoffMs: purgeCutoffMs, log: app.log })` after `registerCatalogSyncWorker`.
      - Add `await boss.schedule(ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE, ANONYMOUS_SHARE_TOKEN_PURGE_CRON, {})`.

### 7 — Postgres integration test
- [ ] Create `apps/api/test/integration/anonymous-share-token-purge.integration.test.ts` following the `demo-cleanup.integration.test.ts` pattern (raw `Pool` + `resetDatabase` + `applyNumberedMigrations`; no `buildApp`).
- [ ] Seed four rows via raw `INSERT` (direct timestamps):
      - `T-old-revoked`: `created_at = NOW() - 120d, revoked_at = NOW() - 100d` → expect deleted
      - `T-old-expired`: `created_at = NOW() - 120d, expires_at = NOW() - 100d, revoked_at = NULL` → expect deleted
      - `T-recent-revoked`: `created_at = NOW() - 10d, revoked_at = NOW() - 10d` → expect preserved
      - `T-active-old-creation`: `created_at = NOW() - 120d, expires_at = NOW() + 30d, revoked_at = NULL` → expect preserved (regression guard for the Q1 retention-yardstick fix)
- [ ] Seed a `users` row first (FK to `owner_user_id`).
- [ ] Call `persistence.purgeTerminalAnonymousShareTokens(90 * 24 * 60 * 60 * 1000)` directly (exercise the SQL, not the pg-boss wiring).
- [ ] Assert return value = `2`.
- [ ] Assert surviving row ids via `SELECT id FROM anonymous_share_tokens ORDER BY id`.
- [ ] Second `it` (non-`describePostgres`, runs always): `new MemoryPersistence()`, seed via `createAnonymousShareToken`, then call `purgeTerminalAnonymousShareTokens(0)` — assert returns `0` and `listAnonymousShareTokensForOwner` count is unchanged.

### 8 — Handler unit test
- [ ] Create `apps/api/test/unit/registerAnonymousShareTokenPurgeWorker.test.ts`:
      - Mock `persistence` with `{ purgeTerminalAnonymousShareTokens: vi.fn().mockResolvedValue(7) }`.
      - Mock `log` with `{ info: vi.fn(), error: vi.fn() }`.
      - Assert handler invokes `purgeTerminalAnonymousShareTokens` with the injected `cutoffMs`.
      - Assert `log.info` called with the success shape.
      - Assert error path: set `purgeTerminalAnonymousShareTokens` to reject, assert handler rethrows + `log.error` called.

### 9 — Docs
- [ ] `docs/001-architecture/sharing.md` — under the "Anonymous share tokens" section, add a paragraph: retention-from-terminality semantics, 90d default via `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` env var, daily 04:00 UTC cron, no audit entry.
- [ ] `docs/002-operations/runbook.md` — append a line: "Token table is purged daily at 04:00 UTC; terminal rows persist ≥ `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` past their terminality. Observe via structured log `anonymous_share_token_purge_completed` / `_failed`."

### 10 — Full-suite validation (pre-PR)
- [ ] Per `full-test-suite.md`, run the canonical pre-push gate:
      ```
      npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
      ```
- [ ] Verify the integration test appears in suite 5 (`test:integration:full:host`), and the handler unit test + memory no-op `it` appear in suite 4.

### 11 — Commit + PR
- [ ] Single commit or logical sequence, each with prefix `feat(api): KZO-152: ...` per `commit-format.md`.
- [ ] Co-Authored-By trailer via Claude Code automation.
- [ ] Request Codex pre-PR review (per `code-review-before-pr.md`) before opening the PR if the diff touches ≥ 5 files or crosses ≥ 2 layers. This diff is ~6 files across api/services + libs/config + tests + docs — worth the review.

## Open Items

_(None — scope resolved entirely in Phase 1. No debate.)_

## References

- Linear ticket: KZO-152
- Related: KZO-147 (open item §2 "Long-tail revoked-token cleanup" is the origin of this ticket)
- KZO-147 scope-todo: `docs/004-notes/kzo-147/scope-todo-202604181855-anonymous-share-tokens.md`
- Table schema: `db/migrations/033_kzo147_anonymous_share_tokens.sql`
- Retention constant: `apps/api/src/lib/anonymousShareToken.ts:27` (`ANONYMOUS_SHARE_TOKEN_RETENTION_MS = 30 days`)
- pg-boss precedent: `apps/api/src/services/market-data/registerCatalogSyncWorker.ts`; scheduling in `apps/api/src/plugins/pgBoss.ts:74`
- Cleanup precedent (for test shape): `apps/api/test/integration/demo-cleanup.integration.test.ts`
- Rules applied: `full-test-suite.md`, `migration-strategy.md` (no migration needed — no schema change), `commit-format.md`, `code-review-before-pr.md`, `service-error-pattern.md` (n/a — cron doesn't throw route errors)
