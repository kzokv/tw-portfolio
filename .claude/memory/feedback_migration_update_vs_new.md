---
name: Migration update vs new file preference
description: When adding constraints or columns to an existing table, update the existing migration file rather than creating a new one
type: feedback
---

When adding a constraint or column to a table that already has a migration file, **update the existing migration file** rather than creating a new sequential file.

**Why:** The user explicitly specified this in the KZO-77 task for adding `UNIQUE` on `users.email` (update migration 014, not create 015). New migration files are for schema changes to new tables or major additions — not for minor constraint additions to existing tables already covered by an earlier migration.

**How to apply:** Before creating a new migration file, check if the targeted table already has a migration. If yes, add the constraint or column to that existing file rather than appending a new one. This keeps schema history consolidated per-table rather than scattered across many files.
