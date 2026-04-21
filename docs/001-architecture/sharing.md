# Sharing Architecture

This document covers user-to-user portfolio sharing, share-coupled invite materialization, the `/sharing` web surface, and the audit/notification side effects introduced for KZO-145/KZO-146.

Related docs:
- [Auth and Session](./auth-and-session.md) — OAuth callback, roles, invite-gated signup
- [Backend, DB & API](./backend-db-api.md) — schema catalog, route inventory, persistence write paths
- [Web Frontend](./web-frontend.md) — AppShell and client-side UX patterns

## Overview

Portfolio sharing is a user-to-user, read-only access model:
- owners remain the source of truth for portfolio data
- grantees receive inbound access records and can view an owner's portfolio from the sharing UI and the TopBar switcher
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
| Use TopBar switcher when inbound shares exist | Yes | Yes | Yes | Yes |
| Write while switched into a shared portfolio | No | No | No | No |
| Use `/admin/audit-log` sharing filters | Yes | n/a | n/a | n/a |

Server enforcement:
- `requireShareGrantorRole(req)` allows only `admin` or `member` when `is_demo !== true`
- read endpoints under the portfolio surface may resolve `contextUserId` to an active share owner
- write endpoints always execute against `sessionUserId`; shared-context writes fail with `write_blocked_viewing_shared`
- non-portfolio identity routes (`/profile`, `/notifications`, `/shares`, `/admin/*`) stay bound to `sessionUserId`

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
- inbound cards include an "Open in switcher" CTA that writes `tw_context_user_id` and routes to `/dashboard`

### TopBar switcher

Visibility:
- hidden when the current user has zero active inbound shares
- shown when one or more active inbound shares exist, regardless of role

Behavior:
- selection writes the readable `tw_context_user_id` cookie
- the web layer forwards that cookie as `x-context-user-id` on API calls
- dashboard, portfolio, ticker history, and transactions read surfaces render the owner's data while switched in
- write controls are hidden in the web UI while switched in; direct write requests are also blocked server-side
- deep links such as `/dashboard?as={ownerUserId}` hydrate the same cookie, then strip `?as=` from the URL

Fallback:
- if the selected owner no longer has an active share, the API falls back to `sessionUserId`
- the fallback response sets `x-context-fallback: revoked` and clears `tw_context_user_id`
- the UI resets to "My Portfolio", shows a revoke toast, and refetches self-scoped data

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

Notification titles and bodies are localized at emit time using the grantee's stored locale:
- Postgres backend: `users.locale` column, folded into existing JOINs (`grantee.locale AS grantee_locale`)
- Memory backend: `stores.get(userId)?.settings.locale ?? "en"`

Localized strings are defined in `apps/api/src/persistence/shareNotificationStrings.ts` (en + zh-TW dictionary; string-template values with `{placeholder}` interpolation). Builders: `buildShareGrantedNotification` / `buildShareRevokedNotification` in `apps/api/src/persistence/shareHelpers.ts` — each accepts `granteeLocale: LocaleCode` (`"en" | "zh-TW"`) with a defensive fallback to `shareNotificationStrings.en` for unknown locales.

Frontend handlers (e.g. the revoke-teardown in `AppShell.tsx`) must discriminate on `detail.kind: "share_granted" | "share_revoked"` — not on title strings, which vary by locale. Canonical helper: `apps/web/lib/sharing-notification-matcher.ts` (exports `isRevokedSharingNotification`).

The notification center remains the primary inbox. KZO-146 also relies on the revoke notification SSE payload to trigger client-side shared-context fallback. Sharing and admin flows continue to expose stable `data-testid` hooks for HTTP/E2E coverage.

## Anonymous Share Tokens

KZO-147 adds a second sharing surface: opaque per-owner tokens that expose a read-only portfolio snapshot to unauthenticated visitors via `/share/{token}`. This channel is disjoint from user-to-user sharing — it does not create `portfolio_shares` rows, does not require a grantee identity, and never allows writes.

### Data Model

#### `anonymous_share_tokens`

Purpose:
- per-owner opaque tokens addressable from a fully public URL

Core columns:
- `id` — stable PK used on owner CRUD paths (revoke); never appears in the public URL
- `token` — 22-char base62, UNIQUE, the public-URL secret
- `owner_user_id` — FK to `users(id)`, `ON DELETE CASCADE`
- `created_at`, `expires_at`, `revoked_at`
- `revoked_by_user_id` — FK to `users(id)`, `ON DELETE SET NULL`

Indexes:
- `idx_anonymous_share_tokens_owner_created_at` — powers the owner list (`created_at DESC`)
- `idx_anonymous_share_tokens_owner_not_revoked` — partial index on non-revoked rows; expiry is filtered in app code because `NOW()` is not immutable

Lifecycle:
- creation inserts an active row; the token is surfaced **once** in the POST response and again in the owner list until it terminates
- revocation flips `revoked_at` only when the row is currently active (`revoked_at IS NULL AND expires_at > NOW()`) — terminal rows are no-ops, protecting the retention clock
- hard-purge of the owner cascades away every token row
- the owner list applies a 30-day retention filter: active rows always appear, terminal rows appear for 30 days past termination, then fall off

### Access Rules

| Surface | admin | member | viewer | demo |
| --- | :-: | :-: | :-: | :-: |
| Create anonymous token on own portfolio | Yes | Yes | No | No |
| List / revoke own tokens | Yes | Yes | No | No |
| Create / revoke while switched into a shared portfolio | No | No | No | No |
| View `/share/{token}` | anyone authenticated or not | — | — | — |
| See `share_token_*` in `/admin/audit-log` | Yes | No | No | No |

Server enforcement:
- `POST /share-tokens` and `DELETE /share-tokens/:id` call `requireShareGrantorRole(req)` + `requireWriteableContext(req)`
- `GET /share-tokens` is guarded only by `requireSessionUserId(req)` — viewers and demo users have no tokens to list, but returning an empty array is fine
- `GET /share/:token` sits in `PUBLIC_ROUTE_KEYS`; no auth header, cookie, or context header is read on this path
- cap-check + insert are serialised per owner via `pg_advisory_xact_lock(hashtext('anon_share:' || owner_user_id))` inside the same transaction, so racing creates can never exceed 20 active

### API Surface

| Method | Path | Guards | Rate limit |
| --- | --- | --- | --- |
| `POST` | `/share-tokens` | role + write-context | global mutation limiter |
| `GET` | `/share-tokens` | session | global read |
| `DELETE` | `/share-tokens/:id` | role + write-context | global mutation limiter |
| `GET` | `/share/:token` | none | per-IP `assertAnonymousShareRateLimit` (default 30 / 5 min) |

All owner-facing responses use the unified DTO:

```ts
type AnonymousShareTokenDto = {
  id: string;
  token: string;         // full, owner-visible
  url: string;           // fully-qualified, API-constructed
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";  // derived server-side
};
```

The public view DTO is **dedicated** (not reused from authenticated holdings) — cost basis is excluded at the type level, not scrubbed at runtime:

```ts
type PublicShareViewDto = {
  ownerDisplayName: string;
  expiresAt: string;
  holdings: Array<{
    ticker: string;
    quantity: number;
    marketValueAmount: number;
    marketValueCurrency: string;
    allocationPercent: number;
  }>;
  summary: {
    totalValueByCurrency: Array<{ currency: string; amount: number }>;
    returnByCurrency: Array<{ currency: string; returnPercent: number }>;
  };
  quoteAsOf: string | null;
};
```

### Public Route Handler

`GET /share/:token` runs a strict order to keep enumeration and oracle risks low:

1. **Rate limit** (`assertAnonymousShareRateLimit(req.ip)`) — runs before any DB work; invalid tokens are also counted. 429 carries `Retry-After: 300`.
2. **Regex pre-check** — malformed tokens `404 token_not_found` without hitting the DB.
3. **Active token lookup** — `revoked_at IS NULL AND expires_at > NOW()` only.
4. **Owner active check** — soft-deleted or deactivated owner → 404.
5. **Load store + resolve quotes** via `loadUserStoreForUserId(app, ownerUserId)`. This helper intentionally drops the `req` dependency so the public route never touches request-scoped identity.
6. **Build DTO** via `buildPublicShareView(store, quotes, ownerDisplayName, expiresAt)` — zero-quantity holdings are filtered, rows without quotes are dropped, per-currency totals and returns are aggregated over the quote-available subset.
7. **Response headers** — `Cache-Control: private, no-store, max-age=0`.

Every failure mode after the rate check surfaces as identical `{ error: "token_not_found" }` with status 404; there is no existence oracle.

### Hygiene and Security

- **Token storage is plaintext.** The owner UI requires re-display of the full URL from the list, so hashing is ruled out. Keep DB access tightly controlled; DB access = token access.
- **Path redaction in logs.** Fastify's `req` serializer rewrites `/share/{22-char base62}` → `/share/[REDACTED]` in request logs. Tokens may still appear in upstream proxy/access logs outside the API boundary.
- **No caching, no indexing.** The Next.js page declares `dynamic = "force-dynamic"` and `robots: { index: false, follow: false }`. `next.config.mjs` adds `Cache-Control: private, no-store, max-age=0`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer` for `/share/:token*`.
- **MUST-NOT gates.** The API handler never reads `req.cookies` / `req.headers.cookie` / `req.headers['x-user-id']` / `req.headers['x-context-user-id']`. The Next.js page never calls `cookies()` and never forwards auth headers on its API fetch.
- **Audit entries are token-id only.** `share_token_created` / `share_token_revoked` metadata carries `tokenId` (the stable PK) and never the plaintext `token`.

### Web Surface

Owner UI lives as Section C of `/sharing` (below Outbound and Inbound), rendered only for non-demo users:

- `PublicLinksSection.tsx` — list + create button + cap banner + flash
- `CreateAnonymousLinkDialog.tsx` — expiry picker (7 / 30 / 90 / custom 1–365 days)
- `AnonymousLinksTable.tsx` — truncated token + Copy URL + status pill + Revoke
- `RevokeAnonymousLinkDialog.tsx` — light confirm, idempotent

The public view (`app/share/[token]/page.tsx`) is a pure server component; failures resolve to a separate `not-found.tsx` with the same layout and no portfolio leakage.

### Audit and Notifications

Audit actions (routed through `/admin/audit-log`'s existing "Sharing" filter group):
- `share_token_created` — metadata: `{ tokenId, expiresAt, ttlDays }`
- `share_token_revoked` — metadata: `{ tokenId }`

No notifications are emitted — the audience is unauthenticated by definition.

### Rate Limit Semantics

- `ANONYMOUS_SHARE_RATE_LIMIT_MAX` (default 30) + `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (default 300_000) — sliding window per `req.ip`
- bucket is in-process (`anonymousShareRateBuckets`); shared with `inviteStatusBuckets` as a "bucket grows unbounded" concern. Eviction is a cross-cutting follow-up, not a KZO-147 fix.

### Purge and Retention

The owner list's 30-day terminal-row filter is an application-layer display filter — it does not delete rows from the table. A daily pg-boss cron hard-deletes terminal rows once their **terminality** is older than the configured threshold. Terminality is defined as `revoked_at` for revoked tokens and `expires_at` for expired-but-not-revoked tokens; `created_at` is not the yardstick. A long-lived token revoked yesterday is retained for 90 days from that revocation event, not from token creation — preserving the 30-day UI visibility window by a comfortable margin.

**Env var:** `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` — Zod `int().min(30).default(90)`. The `.min(30)` is the schema-level invariant that prevents the purge window from undercutting the 30-day UI visibility guarantee (`ANONYMOUS_SHARE_TOKEN_RETENTION_MS` in `apps/api/src/lib/anonymousShareToken.ts`).

**Cron:** `0 4 * * *` (04:00 UTC daily), pg-boss queue `anonymous-share-token-purge`, `policy: "singleton"`.

**Observability:** structured log `anonymous_share_token_purge_completed` on success (`{ deleted, cutoffMs }`) and `anonymous_share_token_purge_failed` on error (`{ error, cutoffMs }`, rethrown for pg-boss retry). No audit log entry is written — purge is a system maintenance operation with no user-visible side effect. See the [Runbook §16 operational checks](../002-operations/runbook.md) for the retention-cleanup monitoring entry.

### Interactions With Other Features

- **KZO-146 switcher.** Write-context guard blocks token create/revoke while the owner is switched into a shared portfolio.
- **KZO-149 hard-purge cascade.** `ON DELETE CASCADE` makes the Postgres side automatic; the memory-backend side is a one-line extension when that ticket lands.
- **KZO-148 admin impersonation.** `POST /share-tokens` and `DELETE /share-tokens/:id` are blocked while impersonating via the blanket write-block in `enforceRouteRole` (any `POST/PUT/PATCH/DELETE` with `isImpersonating=true` returns `403 impersonation_write_blocked`). See [Auth — Admin Impersonation](./auth-and-session.md#admin-impersonation-kzo-148).
