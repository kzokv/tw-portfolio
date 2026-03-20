---
name: KZO-77 Identity Resolution Design
description: Resolved design decisions for first-login user bootstrap and identity resolution — email-based resolution, UUID user IDs, field sync rules, architecture split
type: project
---

## Identity Model (resolved 2026-03-19)

- **Resolution at login: by email** (`users.email`), not `provider_subject`
- `users.email` is UNIQUE — the lookup key for identity resolution
- `users.id` is an app-generated UUID, not Google's sub
- `provider_subject` stored in `user_external_identities` for audit only
- Email change (KZO-79) = Google account migration — changing email means "I'll log in with a different Google account"

**Why:** User wants email to be the identity anchor so that changing email = switching Google accounts. Different Google sub with unregistered email = new user. Same email, different sub = update the external identity (Google account recreated).

**How to apply:** All identity resolution must go through `users.email`, never `provider_subject`. Session cookie contains UUID. Existing sessions break on deploy (acceptable).

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

`provider_email` always mirrors `users.email` — it does NOT track what Google reports on subsequent logins.

## Architecture

- `resolveOrCreateUser(provider, sub, claims)` on Persistence — auth concern, returns UUID
- `ensureDefaultPortfolioData(userId)` refactored from `ensureUserSeed` — domain concern, idempotent safety net in `loadStore`
- `ensureUserSeed` removed, split into the two above
- Transaction: user + external identity = atomic. Default portfolio data = outside transaction.
- dev_bypass: unchanged, lazy creation via safety net in `loadStore`
- e2e helper `POST /__e2e/oauth-session`: updated to call `resolveOrCreateUser`
