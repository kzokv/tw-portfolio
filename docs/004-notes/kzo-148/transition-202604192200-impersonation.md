---
slug: kzo-148
source: transition-guide
created: 2026-04-19
tickets: [KZO-148]
status: frozen
---

# Transition Guide — KZO-148 Admin Impersonation

> **Frozen snapshot.** Do not update after merge. For current behavior, see the evergreen docs linked below.

## What changed

A new feature — **time-limited, audit-logged admin impersonation** — ships with KZO-148. Admins can now view the app as another user, read-only, for 30 minutes by default. Before KZO-148, the only way for an admin to investigate a user's state was either (a) asking the user directly or (b) inspecting the DB.

## Behavioral changes that a future reader should know

### 1. A new cookie `g_impersonation` exists

It's set by `POST /admin/users/:id/impersonate` and cleared by `DELETE /admin/impersonation`, `GET /auth/logout`, and several auto-exit paths. Attributes: HttpOnly, SameSite=Lax, Secure in prod, `COOKIE_DOMAIN`. Payload: `{adminId}.{targetUserId}.{expiresAtMs}.{hmac}`, HMAC-signed with `SESSION_SECRET`.

If you're operating on cookies at the edge (load balancer, Cloudflare Worker, proxy), the cookie domain and attributes match the existing session cookie. No middleware changes needed.

### 2. `req.authContext` gains two fields: `isImpersonating` and `impersonation`

Previously `isImpersonating` was a typed field always hardcoded to `false`. It now carries real state. The companion field `impersonation: { active, targetUserId, targetEmail, expiresAt } | null` is populated only when `isImpersonating=true`.

Consumers that `...req.authContext`-spread into responses may leak the field. `GET /profile` deliberately exposes it (the banner reads it); no other route does.

### 3. A blanket write-block preHandler runs after `hydrateAuthContext`

`enforceRouteRole` now rejects any `POST/PUT/PATCH/DELETE` with `isImpersonating=true` and a `403 impersonation_write_blocked`. Allowlist:

- `POST /admin/users/:id/impersonate` (to rotate targets)
- `DELETE /admin/impersonation` (to exit)

This is different from the sharing-context guard (`requireWriteableContext`), which only blocks portfolio-write taxonomy and leaves narrow-taxonomy writes (profile, notifications, shares) alone. The impersonation block covers **everything** — a stricter rule for a stricter feature.

### 4. New env var `ADMIN_IMPERSONATION_TTL_MINUTES`

Default: `30`. Controls impersonation session lifetime. Stored inside the signed cookie payload (`expiresAtMs`) so expiry is server-enforced regardless of cookie Max-Age.

### 5. Three new `audit_log.action` values

Migration `035_kzo148_impersonation.sql` extends the `audit_log_action_check` CHECK constraint with:
- `impersonation_start`
- `impersonation_end` (with `metadata.reason` ∈ `{manual, replaced, expired, session_mismatch, target_invalid, invalid_hmac}`)
- `impersonation_blocked_write` (with `metadata.method`, `metadata.path`)

Downstream consumers that query audit-log action enums (admin UI filters, external analytics) need to know these exist. The admin audit-log UI already renders them under an "Impersonation" category.

### 6. `/profile` response gains an `impersonation` field

The shape is backwards-compatible (field is `null` when not impersonating) but clients that type-check strictly need to update their `ProfileDto`. The type lives in `libs/shared-types/src/index.ts`.

## Rollout considerations

- **Migration 035 is idempotent** (`DO $$ BEGIN ... END $$` pattern with `DROP CONSTRAINT IF EXISTS` followed by re-add). Safe to re-apply.
- **No data backfill required.** Impersonation is a runtime feature; no persisted state to migrate.
- **Session cookie format unchanged.** Existing sessions remain valid. No forced re-login.
- **`g_impersonation` cookie is transient.** If it exists in a browser before KZO-148 deploys (it won't — but defensively), the server will reject it as `invalid_hmac` and clear it on next request. No client action needed.

## Rollback considerations

If KZO-148 needs to be reverted:
1. Revert the code (admin routes, preHandler, cookie helpers, UI).
2. Migration 035 does **not** need to be reverted — the CHECK constraint is strictly additive. Leaving the three impersonation actions in the allowlist on a rolled-back DB has no effect (no code path writes them).
3. Any `g_impersonation` cookies that persist in browser storage will be HMAC-rejected by the next deploy without the verify helper — safe to leave.

## Evergreen references (for current behavior, NOT frozen)

- [Auth — Admin Impersonation](../../001-architecture/auth-and-session.md#admin-impersonation-kzo-148) — lifecycle, endpoints, auto-exit reasons, test coverage map.
- [Environment Variables — Admin impersonation](../../002-operations/environment-variables.md#admin-impersonation) — `ADMIN_IMPERSONATION_TTL_MINUTES`.
- [Glossary](../../001-architecture/glossary.md) — entries for "Admin impersonation", "Impersonation cookie", "Impersonation write-block".
- [Sharing — Interactions](../../001-architecture/sharing.md) — `/share-tokens` routes blocked during impersonation.

## Frozen artifacts from this ticket's implementation phase

- `scope-todo-202604191530-impersonation.md` — locked scope + completed checklist.
- `mockup-202604191530-impersonation-ui.svg` — UI mockup + request-flow diagram.
- `review-202604192100-self-review.md` — solo-dev self-review.
- `review-202604192130-code-review.md` — adversarial code review (lists H-1 test coverage gap carried forward).

## Known follow-ups filed as tickets

- [KZO-156](https://linear.app/kzokv/issue/KZO-156) — index on `audit_log.action` (volume concern for `impersonation_blocked_write`).
- [KZO-157](https://linear.app/kzokv/issue/KZO-157) — BroadcastChannel cross-tab banner sync.
