---
name: database schema reference pointer
description: Where to find the canonical DB schema catalog (tables, columns, indexes, FKs) — read the architecture doc and migrations, don't rely on this memory
type: reference
---

The canonical DB schema lives in two places — read those before acting:

- **Architecture doc:** `docs/001-architecture/backend-db-api.md` — table catalog, read/write paths, persistence invariants.
- **Migration history:** `db/migrations/001_init.sql` → `033_kzo147_anonymous_share_tokens.sql` (+ `baseline_current_schema.sql`). Always check the latest migrations for recent additions (e.g. `portfolio_shares`, `anonymous_share_tokens`, `audit_log`, `invites`, `user_external_identities`, `app_config`).
- **Sharing-specific tables:** `docs/001-architecture/sharing.md` — `portfolio_shares`, `invites.share_owner_user_id`, `anonymous_share_tokens`.
- **Market-data schema:** `docs/001-architecture/market-data-platform.md` — `market_data.*` tables.

**Why a pointer, not a snapshot:** the schema moves faster than memory can track. Previous snapshot drifted several tables behind by 2026-04-19 (missing the entire KZO-141 epic addition set).

**How to apply:** when a user asks about DB schema, always `Read` the architecture doc + grep the migrations. Do not cite a memorized schema.
