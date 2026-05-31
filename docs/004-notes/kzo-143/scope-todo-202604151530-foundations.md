---
slug: kzo-143
source: scope-grill
created: 2026-04-15
tickets: [KZO-143]
required_reading: [docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md]
superseded_by: null
---

# Todo: KZO-143 — Foundations (role, invites, session_version, INITIAL_ADMIN_EMAIL)

> **For agents starting a fresh session:** read `required_reading` first for the epic-level scope decisions. This file is KZO-143-specific and assumes the parent epic context.

Parent epic: KZO-141 (child ticket KZO-141a). Blocks KZO-144/145/146/147.

## Implementation Steps

### A. Database migration — `030_kzo143_auth_foundations.sql`

- [x] Pre-backfill guard: `SELECT email, LOWER(email) FROM users WHERE email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1`; RAISE EXCEPTION listing duplicates if any exist (abort, require manual resolution)
- [x] `UPDATE users SET email = LOWER(email) WHERE email IS NOT NULL`
- [x] Drop existing `ux_users_email`; create functional unique index `ON users(LOWER(email)) WHERE email IS NOT NULL`
- [x] `ALTER TABLE users ADD CONSTRAINT ck_users_email_lowercase CHECK (email IS NULL OR email = LOWER(email))`
- [x] `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer'))`
- [x] `ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 1`
- [x] Create `invites` table: `code TEXT PRIMARY KEY`, `email TEXT NOT NULL CHECK (email = LOWER(email))`, `role TEXT NOT NULL CHECK (role IN ('admin','member','viewer'))`, `expires_at TIMESTAMPTZ NOT NULL`, `revoked_at TIMESTAMPTZ`, `used_at TIMESTAMPTZ`, `issued_by_user_id TEXT REFERENCES users(id)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Indexes: `UNIQUE(code)` (implicit via PK), `(email) WHERE used_at IS NULL AND revoked_at IS NULL`, `(expires_at) WHERE used_at IS NULL AND revoked_at IS NULL`
- [x] Create `audit_log` table: `id TEXT PRIMARY KEY`, `actor_user_id TEXT REFERENCES users(id)` (nullable for system events), `action TEXT NOT NULL CHECK (action IN ('admin_promote_cli','admin_promote_startup','admin_promote_first_signin'))`, `target_user_id TEXT REFERENCES users(id)` (nullable), `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, `ip_address inet`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Indexes: `(created_at DESC)`, `(actor_user_id, created_at DESC)`, `(target_user_id, created_at DESC)`

### B. Session cookie format + `resolveUserId` refactor

- [x] Update `signSessionCookie` in `apps/api/src/auth/googleOAuth.ts`: oauth path signs `{userId}.{sessionVersion}` → `{userId}.{sessionVersion}.{hmac}`; demo path unchanged (`demo:{userId}.{hmac}`)
- [x] Update `verifySessionCookie` to return `{ userId, isDemo, sessionVersion? }`; disambiguate by part count (2-part demo, 3-part oauth)
- [x] Refactor `resolveUserId` signature → `{ sessionUserId, contextUserId, role, isDemo, isImpersonating }`. In 143, `contextUserId := sessionUserId`, `isImpersonating := false` always
- [x] Add Fastify `preHandler` hook on authenticated routes that loads `{ role, session_version }` from DB once into `req.authContext` (single query per request)
- [x] Session-version mismatch between cookie and `users.session_version` → throw 401 `auth_required`
- [x] Update all 37 `resolveUserId` call sites in `registerRoutes.ts` to destructure the new shape (reads use `contextUserId`; no write-guard assertion in 143)
- [x] Update `apps/web/proxy.ts`: signature-only verification (Edge Runtime safe); no DB check for `session_version`
- [x] Export `bumpSessionVersion(userId)` helper (UPDATE users SET session_version = session_version + 1 WHERE id = $1) — no call sites in 143, consumed by 141b

### C. Env + config

- [x] Add `INITIAL_ADMIN_EMAIL` to `libs/config/src/env-schema.ts` as optional email-validated string
- [x] Update `.env.example` and env-setup generator
- [x] Update `docs/002-operations/environment-variables.md`

### D. Admin bootstrap flow

- [x] Startup routine in `apps/api/src/app.ts` (or equivalent): if `INITIAL_ADMIN_EMAIL` set AND `AUTH_MODE !== 'dev_bypass'` AND matching non-deactivated non-deleted user exists → set `role='admin'` idempotently + emit `admin_promote_startup` audit row (actor_user_id NULL)
- [x] Startup: if `INITIAL_ADMIN_EMAIL` set but no matching user → WARN log ("no user matches INITIAL_ADMIN_EMAIL; admin will be promoted on first sign-in")
- [x] Startup: if `INITIAL_ADMIN_EMAIL` set but matches a deactivated/deleted user → WARN log, no promotion
- [x] Startup: if `INITIAL_ADMIN_EMAIL` unset → WARN log ("no admin bootstrap configured")
- [x] Startup in `dev_bypass` mode: silently skip INITIAL_ADMIN_EMAIL handling (no log)
- [x] OAuth callback: before invite-gate, check `email.toLowerCase() === Env.INITIAL_ADMIN_EMAIL?.toLowerCase()`; match ⇒ create user with `role='admin'`, bypass invite check, emit `admin_promote_first_signin` audit row (actor_user_id NULL)
- [x] Invite NOT consumed when INITIAL_ADMIN_EMAIL short-circuit fires, even if invite for same email exists
- [x] CLI `apps/api/src/cli/adminPromote.ts`, npm script `"admin:promote": "tsx apps/api/src/cli/adminPromote.ts"`; usage: `npm run admin:promote -- email@example.com`
- [x] CLI fails if no matching user ("user must sign in first, or issue an invite")
- [x] CLI promote-only (no demote flag); emits `admin_promote_cli` audit row (actor_user_id NULL)
- [x] CLI `apps/api/src/cli/adminBootstrapInvite.ts`, npm script `"admin:bootstrap-invite": "tsx apps/api/src/cli/adminBootstrapInvite.ts"`; usage: `npm run admin:bootstrap-invite -- email@example.com admin`; inserts directly into `invites` bypassing HTTP auth

### E. Invite lifecycle — API endpoints

- [x] `POST /invites` (admin-only via `requireAdminRole()`): body `{ email, role, expiresAt? }`. Validate email format; reject if any `users` row exists for that email (regardless of lifecycle flags); default `expires_at` to `NOW() + 7 days` if not provided. Generate Crockford base32 code (8 chars, alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`). Retry on UNIQUE violation (max 3 attempts). Returns `{ code, url }` where url = `${WEB_BASE_URL}/invite/${code}`. No audit writer in 143.
- [x] `DELETE /invites/:code` (admin-only): set `revoked_at = NOW()` if not already set; idempotent; returns 204. No audit writer in 143.
- [x] `GET /invites/:code/status` (public, rate-limited): returns `{ status: "valid" | "invalid" | "expired" | "used" | "revoked" }`. No role/email leakage.
- [x] Per-IP sliding window rate limiter for status endpoint (20 req/min); module-level bucket state with `_resetInviteStatusBuckets` test helper

### F. OAuth invite-gated flow

- [x] Extend `generateState()` to 4-part form: `nonce.returnTo_b64.code.hmac(nonce.returnTo_b64.code)`. Accept 2-part (no returnTo, no code), 3-part (returnTo only), 4-part (with code). `returnTo_b64` may be empty string when code-only.
- [x] `extractInviteCode(state)` helper parses the 4-part form
- [x] OAuth callback flow (order matters):
  1. Verify state HMAC
  2. Exchange code for tokens; decode ID token; reject if `email_verified === false`
  3. Normalize email: `.toLowerCase().trim()`
  4. If `email === INITIAL_ADMIN_EMAIL?.toLowerCase()` → bypass invite-gate, create user as admin, emit `admin_promote_first_signin`, sign cookie, redirect
  5. Else if user already exists → log in (no invite consumed)
  6. Else (new email, not admin): validate invite (read-only) → create user with invite.role → consume invite atomically. If validation fails, determine specific reason (`invalid_code`, `expired_code`, `already_used`, `revoked`, or `email_mismatch`); redirect to `/auth/error?reason=...`
  7. If no invite code in state for unknown email → `/auth/error?reason=invite_required`
  8. On success (invite consumed), create user with `role = invite.role`, link external identity, sign cookie, redirect

### G. Web pages

- [x] `apps/web/app/invite/[code]/page.tsx` (public): calls `GET /invites/:code/status`; renders Sign-in-with-Google button embedding code in OAuth state via `/auth/google/start?invite_code=...`. If status ≠ `valid`, renders inline error (invite expired / already used / not found) without Google button.
- [x] `apps/web/app/invite/[code]/page.tsx`: if user already has valid session, render "You're already signed in as {email}. This invite is for a different account. Sign out to accept, or return to dashboard." with [Sign out] + [Dashboard] buttons. Sign out preserves invite URL via `returnTo` query param. Do NOT consume the invite.
- [x] `apps/web/app/auth/error/page.tsx` (public): reads `?reason=` query param; renders i18n-localized copy for each reason (`invite_required`, `invalid_code`, `expired_code`, `email_mismatch`, `already_used`, `revoked`, `account_disabled`). Use string template pattern (no function values in i18n dictionary per `nextjs-i18n-serialization.md`)
- [x] Add `/invite/*` and `/auth/error` to `apps/web/proxy.ts` public-route allowlist

### H. Viewer write-block

- [x] Implement `requireWriterRole(req)` helper that throws 403 `write_blocked_viewer_role` if `req.authContext.role === 'viewer'`
- [x] Implement `requireAdminRole(req)` helper that throws 403 `admin_role_required` for non-admins
- [x] Add `requireWriterRole()` at the top of handlers for: accounts (POST/PATCH/DELETE), transactions (POST/PATCH/DELETE, recompute), fee-profiles (POST/PATCH/DELETE), monitored-tickers (POST/DELETE), dividends (POST/PATCH reconcile, notes), market-data (POST refresh), refresh-batches (POST), daily-holding-snapshots (POST refresh)
- [x] Add `requireAdminRole()` at the top of handlers for: `POST /invites`, `DELETE /invites/:code`
- [x] Do NOT add role check on `POST /auth/demo/start`

### I. Dev_bypass mode updates

- [x] App-startup user-1 upsert (dev_bypass only): INSERT ON CONFLICT — create `id='user-1'`, `role='admin'`, `display_name='Dev User'`; on conflict, do nothing (respects existing `deactivated_at`)
- [x] `resolveUserId` in dev_bypass: honor `x-user-role` header as per-request override; if `x-user-id` provided without `x-user-role` and no DB row matches, fallback role = `'admin'`; never mutate DB
- [x] `x-user-role` override values: `admin` | `member` | `viewer` (validate; reject others with 400)

### J. Demo flow

- [x] Demo user creation path in `registerRoutes.ts` (`POST /auth/demo/start`): set `role = 'member'` explicitly on INSERT
- [x] Demo cookie path unchanged (still 2-part)

### K. E2E test endpoint

- [x] Update `POST /__e2e/oauth-session`: mint 3-part cookie; accept optional `role` (default `admin`) + `sessionVersion` (default 1) query params; update DB user row to match minted values

### L. Docs

- [x] Update `docs/001-architecture/auth-and-session.md`: new cookie format, `resolveUserId` shape, role enum, invites table, audit_log table
- [x] Add "KZO-143 deploy" section to `docs/002-operations/runbook.md`: documents forced one-time re-login for oauth sessions (format mismatch), demo sessions unaffected, no data migration, no rollback impact
- [x] Update `docs/001-architecture/backend-db-api.md`: invites + audit_log tables in ER diagram + column catalog

### M. Tests (unit + integration)

- [x] Unit: `signSessionCookie` / `verifySessionCookie` round-trip for 3-part oauth + 2-part demo; tampering each segment fails verification
- [x] Unit: `parseSessionCookie` disambiguates demo vs. oauth by part count
- [x] Unit: `bumpSessionVersion` increments atomically
- [x] Unit: Crockford base32 invite generator — format, alphabet, collision retry
- [x] Unit: OAuth state 4-part encode/decode with invite code; tamper detection
- [x] Unit: Email lowercase normalization on store + compare
- [x] Integration: OAuth callback happy path with valid invite → user created with invite.role
- [x] Integration: OAuth callback 5 error reasons — invite_required, invalid_code, expired_code, email_mismatch, already_used (+ revoked as 6th)
- [x] Integration: `INITIAL_ADMIN_EMAIL` startup promotion (idempotent on restart)
- [x] Integration: `INITIAL_ADMIN_EMAIL` first-sign-in promotion bypasses invite-gate
- [x] Integration: `INITIAL_ADMIN_EMAIL` match on deactivated user → WARN + no promotion
- [x] Integration: session_version mismatch → 401
- [ ] Integration: CLI `admin:promote` happy path + no-matching-user error
- [ ] Integration: CLI `admin:bootstrap-invite` inserts row
- [x] Integration: Viewer 403 on each write endpoint category
- [x] Integration: Admin-only 403 on `POST /invites` + `DELETE /invites/:code` for non-admin
- [x] Integration: `audit_log` written for all 3 promotion variants
- [x] Integration: `GET /invites/:code/status` returns correct status for each lifecycle state
- [x] Integration: `/invites/:code/status` rate limiter 20/min per IP
- [x] Integration: `POST /invites` rejects when user already exists for email
- [x] Integration: `DELETE /invites/:code` idempotent
- [x] Integration: `dev_bypass` `x-user-role` override + arbitrary `x-user-id` fallback to admin
- [ ] Integration: Migration pre-backfill collision detection (seed collision, expect migration failure)
- [x] Place 409-style tests in `test/integration/` not `test/unit/` (per `test-placement-persistence-backend.md`)

## Open Items

None — all scope decisions locked.

## Deferred Tests

- CLI `admin:promote` / `admin:bootstrap-invite` — underlying persistence methods (`promoteUserToAdminByEmail`, `insertBootstrapInvite`) are tested; CLI scripts are thin wrappers calling those methods directly. Shell-spawn integration tests deferred.
- Migration pre-backfill collision detection — requires real Postgres; deferring to `test:integration:full:host` with managed DB.

## References

- Parent scope-todo: `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`
- Linear: https://linear.app/kzokv/issue/KZO-143
- No debate note written — resolved entirely in Phase 1 grill
- Related rules: `migration-strategy.md`, `nextjs-i18n-serialization.md`, `test-placement-persistence-backend.md`, `config-web-env-pattern.md`, `playwright-oauth-cookie-patterns.md`

## Permissions Matrix (for this ticket's scope)

| Action | admin | member | viewer | demo (member) | dev_bypass default |
|---|:-:|:-:|:-:|:-:|:-:|
| Read own data | ✅ | ✅ | ✅ | ✅ | ✅ (admin) |
| Write own data (accounts/txns/etc.) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Create invite | ✅ | ❌ | ❌ | ❌ | ✅ |
| Revoke invite | ✅ | ❌ | ❌ | ❌ | ✅ |
| CLI admin:promote | n/a (shell) | n/a | n/a | n/a | n/a |
| Consume invite (via callback) | ❌ (already user) | ❌ | ❌ | ❌ | n/a |

## Out of Scope (deferred to other tickets)

- Admin UI shell + user management pages (KZO-144 / 141b)
- Admin audit log UI (KZO-144 / 141b)
- Invite + revoke UI (KZO-144 / 141b)
- Last-admin invariant enforcement (KZO-144 / 141b — CLI is promote-only so 143 can't violate it)
- `session_version` bump triggers (KZO-144 / 141b — disable / delete / role-change)
- Invite create/consume audit writers (KZO-144 / 141b)
- Share grants / anonymous share tokens (KZO-146 / 141c, KZO-147 / 141d)
- Switcher / contextUserId divergence / write-guard assertion (KZO-146 / 141c)
- Impersonation (KZO-148 / 141e)
- Settings UI (KZO-142)
- JWKS-based Google ID token signature verification (pre-existing deferral)
- audit_log retention / cleanup policy
- Metrics on auth/invite events
