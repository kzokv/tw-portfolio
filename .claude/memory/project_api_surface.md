---
name: API route surface reference pointer
description: Where to find the canonical HTTP route inventory, auth/guard sets, and persistence write paths — read the architecture doc, not this memory
type: reference
---

The canonical API surface lives in two places — read those before acting:

- **Architecture doc:** `docs/001-architecture/backend-db-api.md` — endpoint inventory, auth model, write paths.
- **Source of truth:** `apps/api/src/routes/registerRoutes.ts` — route registration + the `PUBLIC_ROUTE_KEYS`, `WRITER_ROLE_ROUTE_KEYS`, `WRITE_CONTEXT_GUARD_ROUTE_KEYS`, `ADMIN_ROUTE_KEYS` sets are the authoritative guard taxonomy.
- **Sharing endpoints:** `docs/001-architecture/sharing.md` — `/shares`, `/share-tokens`, `/share/:token`.
- **Market-data endpoints:** `docs/001-architecture/market-data-platform.md`.

**Auth mode reminder:** `AUTH_MODE=oauth` uses HMAC-signed session cookies; `AUTH_MODE=dev_bypass` accepts `x-user-id` and defaults to `user-1`. Dev-bypass is forbidden in production (`validateEnvConstraints`).

**Why a pointer, not a snapshot:** route additions outpaced previous memory snapshots by the full KZO-141 epic (roles, invites, sharing, admin portal, anonymous share tokens).

**How to apply:** when a user asks about API routes or auth guards, always grep `registerRoutes.ts` for the route key or the guard set. Do not cite a memorized route list.
