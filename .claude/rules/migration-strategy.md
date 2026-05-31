# Migration Strategy

When adding a constraint or column to a table that already has a migration file, **update the existing migration file** rather than creating a new sequential file — **but only if no environment has applied that migration yet.** New migration files are for schema changes to new tables or major additions — not for minor constraint additions to existing tables already covered by an earlier migration.

**Once a migration has been applied to any environment (dev, staging, prod), it is immutable.** Create a new sequential migration for any further changes to that table. Modifying an applied migration is silently skipped by the runner (`schema_migrations` tracks by filename, not content), leaving the database out of sync with the code.

**Why:** The user explicitly specified the consolidation preference (established in KZO-77). The immutability constraint was added after two incidents where in-place edits to applied migrations caused runtime crashes on the QNAP dev database (instruments `type_raw` column missing, `cash_ledger_entries.amount` still INTEGER).

**How to apply:** Before editing an existing migration file, check whether it has been deployed. If `schema_migrations` on any environment contains the filename, create a new migration instead. When in doubt, prefer a new file — an extra migration is cheap, a broken deployment is not.

## Table drops require a full-repo grep

Before merging a migration that runs `DROP TABLE` (or `DROP COLUMN` on a widely-referenced column), grep the entire repo for references to the table/column name. Do not trust self-reported impact analysis in the migration comment — "only X referenced it" comments age silently as new code lands.

```bash
# Before approving a DROP TABLE migration:
grep -rn "<table_name>" apps/ libs/ --include="*.ts" --include="*.sql"
```

Any match outside the migration file itself is a blocker: either remove the reference in the same PR, or document why the code path is dead before shipping.

**Why:** Migration 027 (`027_drop_reconciliation_records.sql`) stated "zero live code paths; only demoCleanup.ts referenced it." One reference at `apps/api/src/persistence/postgres.ts:6028` inside `hardPurgeUser` was missed. Any database that applied migration 027+ had a silently broken `hardPurgeUser` — the bug surfaced only when KZO-149's new Postgres cascade tests exercised the path. Caught via validator iter 3 after three wasted iterations debugging test infrastructure.

**How to apply:** Reviewer checklist item for any migration file containing `DROP TABLE` or `DROP COLUMN`. Also applies when reviewing the PR that *introduces* a cleanup migration — the migration author must have grepped, but the reviewer must re-verify independently.
