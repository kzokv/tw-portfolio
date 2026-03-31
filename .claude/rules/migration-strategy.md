# Migration Strategy

When adding a constraint or column to a table that already has a migration file, **update the existing migration file** rather than creating a new sequential file — **but only if no environment has applied that migration yet.** New migration files are for schema changes to new tables or major additions — not for minor constraint additions to existing tables already covered by an earlier migration.

**Once a migration has been applied to any environment (dev, staging, prod), it is immutable.** Create a new sequential migration for any further changes to that table. Modifying an applied migration is silently skipped by the runner (`schema_migrations` tracks by filename, not content), leaving the database out of sync with the code.

**Why:** The user explicitly specified the consolidation preference (established in KZO-77). The immutability constraint was added after two incidents where in-place edits to applied migrations caused runtime crashes on the QNAP dev database (instruments `type_raw` column missing, `cash_ledger_entries.amount` still INTEGER).

**How to apply:** Before editing an existing migration file, check whether it has been deployed. If `schema_migrations` on any environment contains the filename, create a new migration instead. When in doubt, prefer a new file — an extra migration is cheap, a broken deployment is not.
