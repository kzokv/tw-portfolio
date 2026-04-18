# Sharing Architecture

This document covers user-to-user portfolio sharing, share-coupled invite materialization, the `/sharing` web surface, and the audit/notification side effects introduced for KZO-145/KZO-146.

Related docs:
- [Auth and Session](./auth-and-session.md) — OAuth callback, roles, invite-gated signup
- [Backend, DB & API](./backend-db-api.md) — schema catalog, route inventory, persistence write paths
- [Web Frontend](./web-frontend.md) — AppShell and client-side UX patterns

## Overview

Portfolio sharing is a user-to-user, read-only access model:
- owners remain the source of truth for portfolio data
- grantees receive inbound access records and can view an owner's portfolio from the sharing UI and future switcher flows
- viewers can consume shared access but cannot create new grants
- demo users can view inbound shares but cannot issue share grants

KZO-145 locks the share-grant UI and pending-invite semantics. KZO-146 consumes those decisions for the portfolio switcher and revoked-context fallback.

## Data Model

### `portfolio_shares`

Purpose:
- stores active and historical owner-to-grantee access grants

Core columns:
- `id`
- `owner_user_id` — FK to `users(id)`, `ON DELETE CASCADE`
- `grantee_user_id` — FK to `users(id)`, `ON DELETE CASCADE`
- `created_at`
- `revoked_at`
- `revoked_by_user_id` — FK to `users(id)`, `ON DELETE SET NULL`

Constraints:
- partial unique index on `(owner_user_id, grantee_user_id) WHERE revoked_at IS NULL`

Lifecycle:
- direct grant to an existing user inserts a live row immediately
- share-coupled pending invites do not create a row until the target user signs in
- revocation marks `revoked_at` and records `revoked_by_user_id`
- hard-purge of the owner or grantee cascades away the share row

### `invites.share_owner_user_id`

Purpose:
- links an invite to a future share grant when the target email does not yet belong to a registered user

Behavior:
- nullable FK to `users(id)` with `ON DELETE SET NULL`
- only active when the invite is pending (`used_at IS NULL` and `revoked_at IS NULL`)
- supports owner-scoped rate limiting for pending share grants
- supports OAuth-time share materialization after user resolution

Important detail:
- existing admin-issued invites can be re-used as the transport for share intent by attaching `share_owner_user_id` without rewriting the invite's existing role

## Access Rules

| Surface | admin | member | viewer | demo |
| --- | :-: | :-: | :-: | :-: |
| View `/sharing` | Yes | Yes | Yes (inbound-only) | Yes (inbound-only) |
| Issue share grants | Yes | Yes | No | No |
| Revoke own active grants | Yes | Yes | No | No |
| View inbound shared portfolios | Yes | Yes | Yes | Yes |
| Use `/admin/audit-log` sharing filters | Yes | n/a | n/a | n/a |

Server enforcement:
- `requireShareGrantorRole(req)` allows only `admin` or `member` when `is_demo !== true`
- write endpoints continue to distinguish `sessionUserId` from future `contextUserId` switcher state

## Main Flows

### Existing user grant

1. Owner submits `POST /shares { email }`.
2. Server resolves an existing active user for the normalized email.
3. Server inserts `portfolio_shares`.
4. Server emits `share_granted` audit metadata with owner/grantee identifying fields.
5. Server creates a notification for the grantee with `source = "sharing"` and `sourceRef = share.id`.

### Unknown email grant

1. Owner submits `POST /shares { email }`.
2. Server finds no active user for the normalized email.
3. Server checks the owner's pending share-coupled invite count.
4. Server either:
   - links share intent onto an existing pending invite for that email, or
   - creates a new pending invite with `role = 'viewer'` and `share_owner_user_id = owner`
5. Server returns a copyable invite URL for the owner to send manually.

No `portfolio_shares` row exists yet in this branch of the flow.

### OAuth callback materialization

After OAuth resolves a user identity:

1. The callback loads all active invites for the normalized email where `share_owner_user_id IS NOT NULL`.
2. For each surviving invite:
   - skip share creation if `share_owner_user_id` is now `NULL` because the owner was hard-purged
   - insert an active `portfolio_shares` row if one does not already exist
   - mark the invite used
   - emit `share_granted` audit metadata
3. The grantee can now see the owner's portfolio in the inbound list and future switcher UI.

This keeps share intent durable across invite dedup, admin-issued invite reuse, and "user signed up through a different invite first" races.

### Revocation

Active share revocation:
- owner action immediately revokes the `portfolio_shares` row
- audit action: `share_revoked`
- notification title/body explain that portfolio access was removed

Pending share revocation:
- owner action revokes the linked pending invite rather than a live share row
- the invite becomes unusable, and later OAuth callback processing does not materialize access

## Web Surface

### Avatar menu

- non-demo users see a `Sharing` link in the avatar dropdown
- the link sits below `Admin` when present and above `Sign out`
- demo users do not see the link because the pending-invite flow is not allowed for demo identities

### `/sharing`

Layout rules:
- server-side layout mirrors `/admin/layout.tsx`
- the page loads profile data and conditionally renders sections instead of redirecting

Visibility:
- `admin` / `member` non-demo users get the outbound grant form, outbound table, and inbound list
- `viewer` or demo users get the inbound list only

Sections:
- outbound grant form with email entry and pending-invite confirmation step
- outbound table with active, pending, expired, and optional history rows
- inbound cards showing who shared access with the current user

## Audit and Notifications

### Audit actions

- `share_granted`
- `share_revoked`

Audit metadata should be self-contained after hard-purge:
- `ownerEmail`
- `ownerDisplayName`
- `granteeEmail`
- `granteeDisplayName`
- `shareId`

### Notifications

Notifications reuse the existing notification store:
- `source = "sharing"`
- `sourceRef = share.id`
- `severity = "info"`

Expected titles:
- share granted: "Portfolio shared with you"
- share revoked: "Portfolio access revoked"

The notification center remains the primary inbox. KZO-145 also expects the sharing and admin flows to expose enough stable `data-testid` hooks for HTTP/E2E coverage.
