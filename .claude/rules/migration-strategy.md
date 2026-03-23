# Migration Strategy

When adding a constraint or column to a table that already has a migration file, **update the existing migration file** rather than creating a new sequential file. New migration files are for schema changes to new tables or major additions — not for minor constraint additions to existing tables already covered by an earlier migration.

**Why:** The user explicitly specified this preference (established in KZO-77 for adding `UNIQUE` on `users.email`). Keeps schema history consolidated per-table rather than scattered across many files.

**How to apply:** Before creating a new migration file, check if the targeted table already has a migration. If yes, add the constraint or column to that existing file rather than appending a new one.
