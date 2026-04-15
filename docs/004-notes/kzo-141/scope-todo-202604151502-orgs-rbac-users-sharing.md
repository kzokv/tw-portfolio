---
slug: kzo-141
source: scope-grill
created: 2026-04-15
tickets: [KZO-141, KZO-142, KZO-143, KZO-144, KZO-145, KZO-146, KZO-147, KZO-148]
required_reading: []
superseded_by: null
---

# Todo: KZO-141 — Users, Roles, Invites, Sharing (replaces "Organizations epic")

> **For agents starting a fresh session:** this scope-todo is the sole handoff. The original KZO-141 description proposed organizations + organization_memberships + RBAC (SaaS multi-tenant shape). That was rejected in the scope-grill. This file is authoritative; the original ticket description now has a `## Locked Scope` appendix pointing here.

## Key Scope Shift

Epic reframed from **multi-tenant orgs** → **single-tenant users + roles + invite-gated signup + portfolio sharing + admin portal**.

- No `organizations` table, no `organization_memberships`, no org switcher.
- Single-tenant, single instance, owner is admin.
- Invite-gated signup (no unknown users can register).
- Three fixed roles: `admin`, `member`, `viewer`. Role-derived permissions.
- User-to-user portfolio sharing via switcher/impersonation (read-only).
- Anonymous share links (public read-only URLs) for holdings + performance.
- Admin portal at `/admin` for user management, invites, audit log, app settings.
- Admin impersonation (support-debug) separate from normal switcher, time-limited, audit-logged.

## Child Ticket Breakdown

The epic is split into 5 child tickets + 1 scoping-ticket + KZO-142 repositioned.

| Scope-grill label | Linear ticket | Title |
|---|---|---|
| KZO-141a | [KZO-143](https://linear.app/kzokv/issue/KZO-143) | Foundations — role, invites, session_version, INITIAL_ADMIN_EMAIL |
| KZO-141b | [KZO-144](https://linear.app/kzokv/issue/KZO-144) | Admin management portal — shell + users + invites + audit log |
| KZO-141c-pre | [KZO-145](https://linear.app/kzokv/issue/KZO-145) | Scope-grill — user-to-user share grant UI |
| KZO-141c | [KZO-146](https://linear.app/kzokv/issue/KZO-146) | User-to-user portfolio sharing — switcher UX |
| KZO-141d | [KZO-147](https://linear.app/kzokv/issue/KZO-147) | Anonymous share tokens — public read-only route |
| KZO-141e | [KZO-148](https://linear.app/kzokv/issue/KZO-148) | Admin impersonation — support-debug mode |
| (existing) | [KZO-142](https://linear.app/kzokv/issue/KZO-142) | Admin settings UI — GET/PATCH /settings (repositioned) |

Dependencies:

```
KZO-143 (141a) ──┬──> KZO-144 (141b) ──┬──> KZO-148 (141e)
                 │                     │
                 │                     └──> KZO-142
                 │
                 ├──> KZO-145 (141c-pre) ──> KZO-146 (141c) ──> KZO-148 (141e)
                 │
                 └──> KZO-147 (141d)
```

## Implementation Steps (grouped by child ticket)

### KZO-141a — Foundations ([KZO-143](https://linear.app/kzokv/issue/KZO-143))

- [ ] Add `role` enum (`admin` | `member` | `viewer`) to `users` table; default `member`; backfill existing rows as `member`
- [ ] Add `session_version INT NOT NULL DEFAULT 1` column to `users`
- [ ] Create `invites` table: `code` (unique, 8-char base32-like), `email` (lowercased), `role`, `expires_at`, `revoked_at`, `used_at`, `issued_by_user_id`, `created_at`
- [ ] Create `audit_log` table: `actor_user_id`, `action`, `target_user_id` (nullable), `metadata` (jsonb), `ip_address` (inet nullable), `created_at`; indexes on `(created_at desc)`, `(actor_user_id, created_at desc)`, `(target_user_id, created_at desc)`
- [ ] Refactor `resolveUserId` signature to `{ sessionUserId, contextUserId, role, isDemo, isImpersonating }`; reads use `contextUserId`, writes assert `sessionUserId === contextUserId`
- [ ] Update session cookie format to `{userId}.{sessionVersion}.{hmac}`; reject cookies with mismatched version
- [ ] Add `INITIAL_ADMIN_EMAIL` env var; startup routine promotes matching user to admin (idempotent); promotion also fires on first sign-in if user didn't exist at startup
- [ ] Log WARN + admin-UI banner if `INITIAL_ADMIN_EMAIL` not set or no matching admin exists
- [ ] CLI: `npm run admin:promote -- email@example.com`
- [ ] Invite-gated OAuth callback: on unknown email, require valid/unused/unexpired invite with matching email; consume on success
- [ ] `/invite/{code}` page renders "Sign in with Google to accept" with code in OAuth state
- [ ] `/auth/error?reason={invite_required|invalid_code|expired_code|email_mismatch|already_used}` page
- [ ] Email normalization: lowercase on store (`users.email`, `invites.email`) and on compare
- [ ] Reject invite creation when bound email is already a registered user
- [ ] Viewer role server-side block on all owner-ish write endpoints (accounts, transactions, invites, shares, settings)
- [ ] `dev_bypass` mode: default role `admin`; honor `x-user-role` header; idempotent user upsert respects existing `deactivated_at`
- [ ] Demo user: `role = member`, `is_demo = true`, blocked from creating share links + share grants
- [ ] Tests: unit + integration for all of the above
- [ ] Migration runbook note: existing users will be forced to re-login once after deploy (cookie format change) — acceptable since no production data yet

### KZO-141b — Admin management portal ([KZO-144](https://linear.app/kzokv/issue/KZO-144))

- [ ] `/admin` shell; entry from top-bar profile menu; admin-only route guard
- [ ] `/admin/users`: table (email, name, role, status, last_seen_at, created_at); actions: change role, disable/enable, delete (soft), hard-purge
- [ ] `/admin/users` role change: dropdown (admin/member/viewer); server-side validation
- [ ] Disable: `deactivated_at = NOW`; bumps `session_version`; returns 401 on next request
- [ ] Enable: `deactivated_at = NULL`
- [ ] Delete (soft): `deleted_at = NOW`; filters data from all queries; user cannot log in; bumps `session_version`
- [ ] Hard-purge: typed-phrase confirmation (`PURGE <email>`); server refuses if target has active `recompute_jobs` or `refresh_batches`; transactional cascade DELETE across user_id-referencing tables + share grants + anonymous tokens; emits audit log entry
- [ ] Last-admin hard block: inside transaction, `SELECT count(*) FROM users WHERE role='admin' AND deactivated_at IS NULL AND deleted_at IS NULL FOR UPDATE`; refuse demote/disable/delete/hard-purge that would bring count to 0
- [ ] Self-demote / self-disable / self-delete always blocked regardless of other admins
- [ ] `/admin/invites`: create form (email + role + expiry 1/7/14/30/custom); list with status (pending/used/expired/revoked); copy URL or code; revoke action
- [ ] `/admin/audit`: read-only paginated table; filter by actor / target / action / date range
- [ ] Audit log entries emitted from every admin action (promote, demote, disable, enable, delete, hard-purge, invite-issued, invite-revoked, session-force-logout)
- [ ] Tests: unit + integration + E2E

### KZO-141c-pre — Scope-grill for share-grant UI ([KZO-145](https://linear.app/kzokv/issue/KZO-145))

- [ ] Decide owner's share-grant UI location (drawer? `/portfolio/settings`? dedicated `/sharing`?)
- [ ] Decide grantee-not-yet-a-user flow: (i) reject with "ask admin for invite" or (ii) auto-issue invite with `role=viewer` alongside share grant
- [ ] Decide revoke UX (owner sees list of who they've shared with, per-row revoke button)
- [ ] Decide what admin can see about share grants (earlier rejected `/admin/shares` MVP — reconsider if audit is insufficient)
- [ ] Output: locked scope + updated KZO-141c description

### KZO-141c — User-to-user sharing (switcher) ([KZO-146](https://linear.app/kzokv/issue/KZO-146))

- [ ] Create `portfolio_shares` table: `owner_user_id`, `grantee_user_id`, `created_at`, `revoked_at`, `revoked_by_user_id`; partial unique index on `(owner, grantee) WHERE revoked_at IS NULL`
- [ ] Switcher UI in top bar: shows "My Portfolio" + list of portfolios shared with me; selection persisted via localStorage + URL query param for deep links
- [ ] Owner's share-grant UI per 141c-pre outcome
- [ ] Owner's revoke UI per 141c-pre outcome
- [ ] Write-path guard: every write endpoint asserts `sessionUserId === contextUserId`, else `403 write_blocked_impersonation` / `403 write_blocked_viewing_shared`
- [ ] Switch to revoked portfolio: next API call returns 403; client falls back to own context with toast
- [ ] Viewer landing page when no shares exist
- [ ] Tests: unit + integration + E2E (share/revoke/view/switcher)

### KZO-141d — Anonymous share tokens ([KZO-147](https://linear.app/kzokv/issue/KZO-147))

- [ ] Create `anonymous_share_tokens` table: `token` (22-char base62, unique), `owner_user_id`, `created_at`, `expires_at` (NOT NULL), `revoked_at`
- [ ] Owner UI to create token (expiry picker: 7d/30d/90d default 30d; optional custom); copy link
- [ ] Owner UI to list + revoke active tokens
- [ ] Public route `GET /share/{token}`: unauthenticated; renders holdings + performance summary only (no cost basis, no transactions, no dividends breakdown)
- [ ] Public route always returns 404 with generic "link not found or expired" on any failure (expired, revoked, not-found) — prevent enumeration
- [ ] Per-IP rate limit on `/share/*` (sliding window; reasonable default e.g. 30 requests / 5 min)
- [ ] Tests: integration + E2E

### KZO-141e — Admin impersonation ([KZO-148](https://linear.app/kzokv/issue/KZO-148))

- [ ] "Impersonate" button per row in `/admin/users` (admin-only)
- [ ] Impersonation token: short-lived (30 min default, env-configurable); signed payload `{ impersonator: adminId, target: targetId, expiresAt }`
- [ ] UI: persistent red banner "Impersonating <email> — auto-exit in MM:SS" + [Exit Impersonation] button
- [ ] Server: `resolveUserId` returns `isImpersonating=true` when valid impersonation token present; `contextUserId = target`, `sessionUserId = admin`
- [ ] Server: all write endpoints reject with `403 impersonation_write_blocked` when `isImpersonating`
- [ ] Auto-exit on token expiry; client reverts to admin's own context
- [ ] Audit log: `impersonation_start`, `impersonation_end`, `impersonation_blocked_write`
- [ ] Tests: unit + integration + E2E

### KZO-142 (existing ticket, repositioned) ([KZO-142](https://linear.app/kzokv/issue/KZO-142))

- [ ] `/admin/settings` tab fills in; GET/PATCH `/app_config` (fulfills KZO-133's deferred admin write path)
- [ ] Depends on KZO-141b (admin shell + audit log)
- [ ] Audit log entry on every app_config update

## Open Items (carried forward)

- [ ] **B2** — share-grant UI details (location, non-user flow, revoke UX): deferred to KZO-141c-pre scope-grill
- [ ] Migration runbook update: note forced re-login on deploy

## References

- Original KZO-141 ticket description (pre-scope): `https://linear.app/kzokv/issue/KZO-141/organizations-membership-rbac-multi-tenancy-epic`
- KZO-133 context (why KZO-141 was spawned): `docs/004-notes/kzo-133/scope-todo-202604151059-app-config.md`
- Phase 0 codebase findings: captured inline in this scope-grill session (not persisted separately)
- No debate note written — scope resolved entirely in Phase 1

## Permissions Matrix (reference)

| Action | admin | member | viewer |
|---|:-:|:-:|:-:|
| View /admin/* | ✅ | ❌ | ❌ |
| Promote/demote/disable/delete users | ✅ | ❌ | ❌ |
| Issue invites | ✅ | ❌ | ❌ |
| Edit app_config | ✅ | ❌ | ❌ |
| Own a portfolio (create accounts/transactions) | ✅ | ✅ | ❌ |
| Issue user-to-user share grants on own portfolio | ✅ | ✅ | ❌ |
| Issue anonymous share tokens on own portfolio | ✅ | ✅ | ❌ |
| View portfolios shared to them (switcher) | ✅ | ✅ | ✅ |
| Impersonate any user (support-debug, read-only) | ✅ | ❌ | ❌ |

## Out of Scope (explicitly rejected)

- Password-based authentication
- Organizations / tenants / workspaces / multi-tenant shape
- Per-user permission grants (Design 2) — use role-derived only
- Cross-user merged portfolio view (Shape A) — switcher only
- Per-account / per-symbol anonymous share tokens
- Admin-visible `/admin/shares` page — users manage their own shares
- Delete-user undoable-by-admin beyond soft-delete flag (no "trash" UI)
