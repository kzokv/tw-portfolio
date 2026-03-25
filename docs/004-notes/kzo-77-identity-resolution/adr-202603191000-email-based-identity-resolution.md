# ADR: Email-Based Identity Resolution (KZO-77)

**Date:** 2026-03-19
**Status:** Resolved (frozen snapshot)
**Ticket:** KZO-77

## Decision

User identity is resolved by `users.email` (UNIQUE), not by OAuth provider subject. The session cookie stores the internal app-generated UUID, not the Google sub.

## Rationale

User wants email to be the identity anchor so that:
- **Changing email = switching Google accounts** — different Google sub with unregistered email = new user
- **Same email, different sub = account recovery** — update the external identity record
- This decouples session identity from OAuth provider state

## Identity Model

| Field | Value | Purpose |
|---|---|---|
| `users.id` | UUID (app-generated) | Primary key, session identifier |
| `users.email` | Unique string | Lookup key for identity resolution |
| `user_external_identities.provider_subject` | Google sub | Audit trail, identity verification |
| Session cookie | `${userId}.${hmac}` | Signed session token carrying UUID |

## Field Sync Rules on Login

| Field | First login | Subsequent login |
|---|---|---|
| `users.email` | Seed from Google | Don't touch |
| `users.display_name` | Seed from Google | Update from Google |
| `ext.provider_email` | Mirror `users.email` | Don't touch |
| `ext.provider_display_name` | Seed from Google | Update from Google |
| `ext.provider_picture_url` | Seed from Google | Update from Google |
| `ext.provider_subject` | Seed from Google | Update if changed |
| `ext.last_seen_at` | Now | Update to now |

Note: `provider_email` always mirrors `users.email` — it does NOT track what Google reports on subsequent logins.

## Architecture Changes

### New Split: `resolveOrCreateUser` (Persistence concern)
- Called during OAuth callback
- Looks up user by email or creates new
- Returns UUID
- Atomic transaction: user + external identity

### Moved: `ensureDefaultPortfolioData` (Domain concern)
- Refactored from `ensureUserSeed`
- Idempotent safety net in `loadStore`
- Outside user creation transaction
- Runs on every load to ensure defaults exist

### Removed: `ensureUserSeed`
- Split into the two above
- No longer needed as monolithic function

## Session Cookie Format

Before (Google sub-based):
```
session: <google-sub>.hmac(google-sub, SESSION_SECRET)
```

After (UUID-based):
```
session: <user-uuid>.hmac(user-uuid, SESSION_SECRET)
```

Both use HMAC signing via `signSessionCookie()` / `verifySessionCookie()` in `googleOAuth.ts`.

## E2E Helper

`POST /__e2e/oauth-session` (development-only endpoint):
- Accepts `sub` and `claims` from test
- Calls `resolveOrCreateUser` to create/resolve user
- Returns signed cookie + user UUID
- Gated to `NODE_ENV !== "production"`

## Impact on Existing Sessions

Changing from sub-based to UUID-based cookies invalidates all existing sessions. Users must re-login after deploy. **This is acceptable** as a one-time migration.

## Testing

- OAuth E2E tests use `/__e2e/oauth-session` with hardcoded sub in CI
- Integration tests use Postgres to verify identity resolution
- dev_bypass mode still works via `loadStore` safety net

## Related Decisions

- **Session cookie HMAC:** Stored as `${userId}.${hmac}` format
- **Cookie domain coupling:** `SESSION_COOKIE_NAME` + `COOKIE_DOMAIN` must be consistent
- **OAuth e2e automation:** Refresh token (local) or hardcoded sub (CI)
