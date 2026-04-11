---
slug: kzo-31
source: scope-grill
created: 2026-04-11
tickets: [KZO-31]
required_reading:
  - docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md
  - docs/004-notes/kzo-32/scope-todo-202604110430-initial.md
  - .claude/rules/migration-strategy.md
  - .claude/rules/replay-position-history-invariants.md
  - .claude/rules/service-error-pattern.md
  - .claude/rules/full-test-suite.md
  - .claude/rules/test-placement-persistence-backend.md
superseded_by: null
---

# Todo: KZO-31 — Reconciliation filter API + schema cleanup

> **For agents starting a fresh session:** read all files listed in `required_reading` above before
> starting implementation. Also read `AGENTS.md` at repo root and each touched subtree.

## Context

KZO-37 shipped the dividend reconciliation PATCH endpoint and state machine.
KZO-32 shipped the drawer UI (status badges, reconciliation section with independent save button).

KZO-31 is now **purely backend + schema cleanup** — no UI, no new page, no count endpoint.

It unblocks KZO-136, which builds a date-range review table and needs a server-side
`reconciliationStatus` filter to drive its "open items only" preset.

### Why two filter params, not one

`reconciliationStatus=open` alone returns **both** `expected` and `posted+open` entries.
`expected` entries (not yet received) are noise in a review queue. Adding an independent
`postingStatus` param keeps filters orthogonal and lets KZO-136 request
`?reconciliationStatus=open&postingStatus=posted` for a clean queue view.
KZO-136 may also choose to client-side filter `expected` entries — both approaches work.

### Why Option A (inline columns) not Option B (reconciliation_records table)

`reconciliation_records.difference_reason` is `TEXT NOT NULL` — hostile to the open/matched/
explained/resolved flow where the user hasn't stated a reason yet. The table was designed for
import-matching workflows (`source_reference`, `source_file_name`, `source_row_key`), not manual
review. Inline columns follow the established KZO-37 precedent and need no joins to query
current status. Option B was rejected.

### Out of scope

- Trade event or cash ledger entry reconciliation (user is source of truth for both; no
  external reference fact to reconcile against)
- Any UI changes (KZO-136 owns the review table view)
- Count/summary endpoint (client-side derivation from returned rows is sufficient)
- Global reconciliation queue page (the KZO-136 date-range table with `open` filter IS the queue)
- `baseline_current_schema.sql` modification — immutable (applied to QNAP); new installs will
  create then drop `reconciliation_records` — acceptable

---

## Implementation Steps

### Step 1 — Migration 027

- [ ] Create `db/migrations/027_drop_reconciliation_records.sql`

  ```sql
  -- Drop the dead reconciliation_records table (zero live code paths; only
  -- demoCleanup.ts referenced it and that DELETE is removed in this PR).
  -- Indexes on reconciliation_records are auto-dropped with the table.
  DROP TABLE IF EXISTS reconciliation_records;

  -- Enforce posting/reconciliation status coupling at the DB level.
  -- Service layer (dividends.ts:354) and upsert guard (postgres.ts:3769)
  -- already enforce this; this constraint is defence-in-depth.
  -- Rule: expected → must be open; posted/adjusted → any reconciliation status allowed.
  ALTER TABLE dividend_ledger_entries
    ADD CONSTRAINT ck_dividend_ledger_entries_reconciliation_coupling
    CHECK (
      (posting_status = 'expected' AND reconciliation_status = 'open')
      OR posting_status IN ('posted', 'adjusted')
    );
  ```

  > Before running against the QNAP DB: verify no rows would violate the CHECK constraint:
  > ```sql
  > SELECT count(*) FROM dividend_ledger_entries
  > WHERE NOT (
  >   (posting_status = 'expected' AND reconciliation_status = 'open')
  >   OR posting_status IN ('posted', 'adjusted')
  > );
  > -- Expected: 0
  > ```

### Step 2 — Remove dead demoCleanup.ts line

- [ ] In `apps/api/src/services/demoCleanup.ts:26`, delete:
  ```ts
  await client.query(`DELETE FROM reconciliation_records WHERE user_id = ANY($1)`, [userIds]);
  ```
  Verify no other reference to `reconciliation_records` remains in the codebase.

### Step 3 — Route schema (`apps/api/src/routes/registerRoutes.ts`)

- [ ] Extend `dividendLedgerQuerySchema` with two new optional params:
  ```ts
  const dividendLedgerQuerySchema = dividendDateRangeQuerySchema.extend({
    accountId: userScopedIdSchema.optional(),
    reconciliationStatus: z.enum(["open", "matched", "explained", "resolved"]).optional(),
    postingStatus: z.enum(["expected", "posted", "adjusted"]).optional(),
  });
  ```
- [ ] In the `GET /portfolio/dividends/ledger` route handler, pass both new params to persistence:
  ```ts
  const ledgerEntries = await app.persistence.listDividendLedgerEntriesByPaymentDate(
    userId,
    query.accountId,
    query.fromPaymentDate,
    query.toPaymentDate,
    query.limit,
    query.reconciliationStatus,  // new
    query.postingStatus,         // new
  );
  ```

### Step 4 — Persistence interface (`apps/api/src/persistence/types.ts`)

- [ ] Update `listDividendLedgerEntriesByPaymentDate` signature:
  ```ts
  listDividendLedgerEntriesByPaymentDate(
    userId: string,
    accountId?: string,
    fromPaymentDate?: string,
    toPaymentDate?: string,
    limit?: number,
    reconciliationStatus?: DividendLedgerEntry["reconciliationStatus"],  // new
    postingStatus?: DividendPostingStatus,                               // new
  ): Promise<Array<DividendLedgerEntry & { ... }>>;
  ```

### Step 5 — Memory backend (`apps/api/src/persistence/memory.ts`)

- [ ] Add two filter clauses after the existing `accountId` filter (around line 428):
  ```ts
  .filter((entry) => !reconciliationStatus || entry.reconciliationStatus === reconciliationStatus)
  .filter((entry) => !postingStatus || entry.postingStatus === postingStatus)
  ```

### Step 6 — Postgres backend (`apps/api/src/persistence/postgres.ts`)

- [ ] Update `listDividendLedgerEntriesByPaymentDate` (around line 1876):
  - Add two new params to the function signature
  - Add to the WHERE clause:
    ```sql
    AND ($6::text IS NULL OR dle.reconciliation_status = $6)
    AND ($7::text IS NULL OR dle.posting_status = $7)
    ```
  - Pass `reconciliationStatus ?? null` and `postingStatus ?? null` as params `$6` and `$7`
  - Update the `LIMIT $5` → `LIMIT $5` stays, params shift to accommodate

  > Note: existing params are `[$1=userId, $2=accountId, $3=fromPaymentDate, $4=toPaymentDate, $5=limit]`.
  > New params are `$6=reconciliationStatus, $7=postingStatus`. Limit stays at `$5`.

### Step 7 — Integration tests

- [ ] Add tests in `apps/api/test/integration/` (per `test-placement-persistence-backend.md`):
  - `GET /portfolio/dividends/ledger?reconciliationStatus=open` returns only `open` entries
  - `GET /portfolio/dividends/ledger?reconciliationStatus=matched` returns only `matched` entries
  - `GET /portfolio/dividends/ledger?postingStatus=posted` returns only `posted` entries
  - `GET /portfolio/dividends/ledger?reconciliationStatus=open&postingStatus=posted` returns
    intersection — excludes `expected+open` entries
  - Filter with no matching results returns `{ ledgerEntries: [] }`

### Step 8 — Verify full test suite

- [ ] `npx eslint .` — lint clean
- [ ] `npm run typecheck` — no type errors
- [ ] `npm run test --prefix apps/web` — web unit tests pass
- [ ] `npm run test:integration:full:host` — API integration tests pass (includes new filter tests)
- [ ] `npm run test:e2e:bypass:mem --prefix apps/web` — standard E2E passes
- [ ] `npm run test:e2e:oauth:mem --prefix apps/web` — OAuth E2E passes
- [ ] `npm run test:http --prefix apps/api` — API HTTP tests pass

---

## Open Items

None. KZO-136 is the dependent ticket and is tracked separately.

---

## References

- Linear ticket: KZO-31 — https://linear.app/kzokv/issue/KZO-31
- Dependent: KZO-136 (date-range review table UI, uses the new filter params)
- Canonical reconciliation PATCH: `apps/api/src/routes/registerRoutes.ts` ~line 1674
- Posting/reconciliation coupling rules: `docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md` §Status Meaning
- Existing upsert guard: `apps/api/src/persistence/postgres.ts` ~line 3769
- Service layer guard: `apps/api/src/services/dividends.ts` ~line 354
