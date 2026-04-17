---
slug: kzo-144
source: scope-grill
created: 2026-04-17
tickets: [KZO-144]
required_reading:
  - docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md
  - docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md
superseded_by: null
---

# Todo: KZO-144 — Admin Management Portal (shell + users + invites + audit log)

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. KZO-143 (foundations) is complete and merged — roles, invites, audit_log (3 action types), resolveUserId refactor, session_version, requireAdminRole/requireWriterRole are all shipped.

Parent epic: KZO-141 (child ticket KZO-141b). Depends on KZO-143 (complete). Blocks KZO-142, KZO-148.

## Key Decisions from Scope Grill

1. **Audit action strings** — 8 new actions added via migration ALTER CHECK: `admin_role_change`, `admin_disable_user`, `admin_enable_user`, `admin_delete_user`, `admin_hard_purge_user`, `admin_invite_issued`, `admin_invite_revoked`, `session_force_logout`
2. **Hard-purge cascade** — only tables that exist today; follow-up ticket for KZO-146/147 to extend cascade to `portfolio_shares` and `anonymous_share_tokens`
3. **Hard-purge job pre-check** — query `pgboss.job` directly + `refresh_batches`; persistence exposes `hasActiveJobs(userId)`; memory backend returns `false`
4. **Pagination** — offset for all admin list endpoints: `{ items: T[], total: number, page: number, limit: number }`, default limit 50, max 100
5. **Admin shell** — separate layout (`/admin/layout.tsx`) with own sidebar (Users, Invites, Audit Log); shared TopBar; "Admin" link in profile dropdown conditional on `role === 'admin'`
6. **ProfileDto** — add `role: UserRole` field (cross-cutting: shared-types + API + web)
7. **Soft-delete** — one-way gate toward hard-purge; no un-delete path; user row preserved with `deleted_at` set; login blocked; session bumped; portfolio data untouched
8. **Self-operation blocks** — server-side `targetUserId === sessionUserId` → 403 on role change, disable, soft-delete, hard-purge; UI shows "(you)" badge on own row with disabled action buttons
9. **Invite UI** — calls existing `POST /invites` + `DELETE /invites/:code` with audit logging added to those handlers; new `GET /admin/invites` for list view
10. **Hard-purge confirmation** — server-enforced: body `{ confirmation: "PURGE target@email.com", adminEmail: "admin@email.com" }`; client double-confirmation: type target phrase, then type own email
11. **API prefix** — all new endpoints under `/admin/*`; existing invite endpoints keep their paths
12. **Endpoint style** — action-verb sub-resources (e.g. `/admin/users/:id/disable`)
13. **User status** — derived from `deactivated_at` / `deleted_at`: `active` | `disabled` | `deleted`; default list shows active + disabled; deleted visible with `?status=deleted`
14. **Audit log FKs** — ALTER `target_user_id` and `actor_user_id` to `ON DELETE SET NULL`; ALL audit entries store identifying info (`actorEmail`, `targetEmail`, `targetDisplayName`) in metadata JSONB as standard practice
15. **Last-admin invariant** — `FOR UPDATE` lock on admin count; `409 last_admin_blocked` error code
16. **Web route guard** — server component check in `/admin/layout.tsx` via profile API call; redirect non-admins to `/dashboard`
17. **Audit log action filter** — comma-separated multi-value: `?action=admin_disable_user,admin_enable_user`
18. **`session_force_logout`** — side-effect audit row emitted alongside disable, soft-delete, and hard-purge; not a standalone UI action
19. **Enable endpoint** — `POST /admin/users/:id/enable`, sets `deactivated_at = NULL`, emits `admin_enable_user` audit entry, no `session_version` bump
20. **Invite list** — includes issuer info (`issuedByEmail`, `issuedByDisplayName`) from join
21. **Current admin "(you)" badge** — frontend matches `user.id === profile.userId`; self-action buttons disabled with tooltip
22. **Audit metadata enrichment** — backfill pattern: all `appendAuditLog` calls include identifying info in metadata so entries are self-contained after hard-purge

## Implementation Steps

### A. Database migration — `031_kzo144_admin_portal.sql`

- [x] ALTER `audit_log` CHECK constraint to add 8 new action types: `admin_role_change`, `admin_disable_user`, `admin_enable_user`, `admin_delete_user`, `admin_hard_purge_user`, `admin_invite_issued`, `admin_invite_revoked`, `session_force_logout`
- [x] ALTER `audit_log.actor_user_id` FK to `ON DELETE SET NULL`
- [x] ALTER `audit_log.target_user_id` FK to `ON DELETE SET NULL`
- [x] ALTER `invites.issued_by_user_id` FK to `ON DELETE SET NULL`

### B. Shared types — DTOs

- [x] Add `role: UserRole` to `ProfileDto` in `libs/shared-types/src/index.ts`
- [x] Add `AdminUserListItemDto`: `{ userId, email, displayName, role, status: 'active' | 'disabled' | 'deleted', lastSeenAt, createdAt }`
- [x] Add `AdminUserListResponse`: `{ items: AdminUserListItemDto[], total: number, page: number, limit: number }`
- [x] Add `AdminInviteListItemDto`: `{ code, email, role, status: InviteStatus, expiresAt, usedAt, revokedAt, issuedByEmail, issuedByDisplayName, createdAt }`
- [x] Add `AdminInviteListResponse`: `{ items: AdminInviteListItemDto[], total: number, page: number, limit: number }`
- [x] Add `AdminAuditLogEntryDto`: `{ id, actorUserId, actorEmail, action, targetUserId, targetEmail, targetDisplayName, metadata, ipAddress, createdAt }`
- [x] Add `AdminAuditLogResponse`: `{ items: AdminAuditLogEntryDto[], total: number, page: number, limit: number }`

### C. Persistence layer — new methods

- [x] `listUsers(options: { page, limit, search?, role?, status? })`: offset-paginated user list; status derived from `deactivated_at` / `deleted_at`; search matches email/display_name substring (case-insensitive); default sort `created_at DESC`
- [x] `changeUserRole(userId, newRole, auditInput)`: transactional role update + audit log entry with `{ fromRole, toRole }` metadata; returns updated user
- [x] `disableUser(userId, auditInput)`: sets `deactivated_at = NOW()`, bumps `session_version`, emits `admin_disable_user` + `session_force_logout` audit entries
- [x] `enableUser(userId, auditInput)`: sets `deactivated_at = NULL`, emits `admin_enable_user` audit entry; NO `session_version` bump
- [x] `softDeleteUser(userId, auditInput)`: sets `deleted_at = NOW()`, bumps `session_version`, emits `admin_delete_user` + `session_force_logout` audit entries
- [x] `hardPurgeUser(userId, auditInput)`: transactional cascade DELETE across all user_id-referencing tables that exist today (see cascade table list below); emits `admin_hard_purge_user` + `session_force_logout` audit entries with `{ targetEmail, targetDisplayName }` in metadata; audit entries inserted BEFORE user row deletion (FK then set to NULL by ON DELETE SET NULL)
- [x] `hasActiveJobs(userId)`: Postgres queries `pgboss.job` (state IN created/active/retry, data->>'userId' match) + `refresh_batches` (non-terminal status for user); memory returns `false`
- [x] `countActiveAdmins()`: `SELECT count(*) FROM users WHERE role='admin' AND deactivated_at IS NULL AND deleted_at IS NULL` with `FOR UPDATE` lock; used in last-admin check
- [x] `listInvites(options: { page, limit, status?, email? })`: offset-paginated invite list with issuer info join; status derived from `used_at` / `revoked_at` / `expires_at`; default sort `created_at DESC`
- [x] `listAuditLog(options: { page, limit, actorUserId?, targetUserId?, actions?: string[], fromDate?, toDate? })`: offset-paginated audit log with actor/target email from metadata; default sort `created_at DESC`
- [x] Update `appendAuditLog` to accept expanded action union type (11 total)
- [x] Update ALL existing `appendAuditLog` call sites (KZO-143 promotion paths) to include `{ targetEmail }` in metadata
- [x] Implement all above methods in both `postgres.ts` and `memory.ts`

**Hard-purge cascade table list (tables that exist today referencing `users.id`):**
- `external_identities` (user_id)
- `accounts` → cascades to: `trade_events`, `lots`, `lot_allocations`, `cash_ledger_entries`, `daily_holding_snapshots`
- `fee_profiles` (user_id)
- `monitored_tickers` (user_id)
- `dividend_ledger_entries` (user_id)
- `refresh_batches` (user_id)
- `invites` (issued_by_user_id) — SET NULL, not DELETE (preserve invite records)
- `audit_log` (actor_user_id, target_user_id) — SET NULL via FK, not DELETE

### D. API routes — admin endpoints

- [x] `GET /admin/users` — list users; query params: `page`, `limit`, `search`, `role`, `status`; requireAdminRole
- [x] `PATCH /admin/users/:id/role` — body: `{ role: UserRole }`; last-admin check if target is admin being demoted; self-block; requireAdminRole; emits `admin_role_change` + `session_force_logout` if role changed from admin (session invalidated to force re-auth with new role)
- [x] `POST /admin/users/:id/disable` — last-admin check if target is admin; self-block; requireAdminRole; emits `admin_disable_user` + `session_force_logout`
- [x] `POST /admin/users/:id/enable` — self-block (can't be disabled and logged in, but enforce anyway); requireAdminRole; emits `admin_enable_user`
- [x] `DELETE /admin/users/:id` — soft delete; last-admin check if target is admin; self-block; requireAdminRole; emits `admin_delete_user` + `session_force_logout`
- [x] `DELETE /admin/users/:id/purge` — hard purge; body: `{ confirmation: "PURGE <email>", adminEmail: "<admin's email>" }`; server validates both strings; hasActiveJobs pre-check; last-admin check if target is admin; self-block; requireAdminRole; emits `admin_hard_purge_user` + `session_force_logout`
- [x] `GET /admin/invites` — list invites; query params: `page`, `limit`, `status`, `email`; requireAdminRole
- [x] `GET /admin/audit-log` — list audit entries; query params: `page`, `limit`, `actorUserId`, `targetUserId`, `action` (comma-separated), `fromDate`, `toDate`; requireAdminRole
- [x] Add audit logging to existing `POST /invites` handler: emit `admin_invite_issued` with `{ targetEmail, inviteCode, role }` in metadata
- [x] Add audit logging to existing `DELETE /invites/:code` handler: emit `admin_invite_revoked` with `{ inviteCode, targetEmail }` in metadata
- [x] Update `GET /profile` response to include `role` field

### E. Web app — admin shell and layout

- [x] Create `apps/web/app/admin/layout.tsx`: server component; reads session → calls `GET /profile` → checks `role === 'admin'` → redirects to `/dashboard` if not; renders admin sidebar (Users, Invites, Audit Log tabs) + shared TopBar
- [x] Create admin sidebar component with navigation links to `/admin/users`, `/admin/invites`, `/admin/audit-log`
- [x] Add `/admin` and `/admin/*` to `apps/web/proxy.ts` authenticated route list (not public)
- [x] Update `UserAvatarButton.tsx` (profile dropdown): conditionally show "Admin" link when `role === 'admin'`; pass `role` through from profile data
- [x] Propagate `role` from profile API response through to TopBar → UserAvatarButton

### F. Web app — `/admin/users` page

- [x] User list table: columns — email, display name, role, status (badge), last seen, created at
- [x] Current admin's row: "(you)" badge, action buttons disabled with tooltip
- [x] Role change: dropdown (admin/member/viewer) per row; calls `PATCH /admin/users/:id/role`; confirmation dialog for admin demotion
- [x] Disable button: calls `POST /admin/users/:id/disable`; confirmation dialog
- [x] Enable button (shown on disabled users): calls `POST /admin/users/:id/enable`
- [x] Delete button: calls `DELETE /admin/users/:id`; confirmation dialog
- [x] Hard-purge button (shown on soft-deleted users, or as escalated action): two-step confirmation dialog — type `PURGE <email>`, then type own email; calls `DELETE /admin/users/:id/purge`
- [x] Status filter tabs or dropdown: active (default) / disabled / deleted / all
- [x] Search input: email/name substring
- [x] Role filter dropdown
- [x] Pagination controls
- [x] Error handling: `last_admin_blocked` → specific UI message; `self_operation_blocked` → specific UI message

### G. Web app — `/admin/invites` page

- [x] Create invite form: email input + role dropdown (admin/member/viewer) + expiry presets (1d/7d/14d/30d/custom) with date picker for custom
- [x] Invite list table: columns — email, role, status (badge: pending/used/expired/revoked), issued by, expires at, created at
- [x] Copy URL button per row (copies `${WEB_BASE_URL}/invite/${code}`)
- [x] Copy code button per row
- [x] Revoke button on pending invites: calls `DELETE /invites/:code`; confirmation dialog
- [x] Status filter: pending / used / expired / revoked / all
- [x] Pagination controls

### H. Web app — `/admin/audit-log` page

- [x] Read-only paginated table: columns — timestamp, actor (email), action (human-readable label), target (email/name), metadata summary
- [x] Filter by actor (dropdown or search of user emails)
- [x] Filter by target (dropdown or search of user emails)
- [x] Filter by action (multi-select checkboxes, grouped by category: role changes, user lifecycle, invites, session)
- [x] Filter by date range (from/to date pickers)
- [x] Pagination controls
- [x] Action display: render human-readable labels (e.g. `admin_disable_user` → "Disabled user")

### I. Tests

- [x] **Unit**: `changeUserRole` — role updated, audit entry with `{ fromRole, toRole }` in metadata
- [x] **Unit**: `disableUser` / `enableUser` — `deactivated_at` toggled, `session_version` bumped (disable only), correct audit entries
- [x] **Unit**: `softDeleteUser` — `deleted_at` set, `session_version` bumped, correct audit entries
- [x] **Unit**: `hardPurgeUser` — cascade deletes all user-referencing data; audit entries stored with identifying metadata; user row gone
- [x] **Unit**: `hasActiveJobs` — returns true when pgboss job or refresh_batch active; false when none; memory always false
- [x] **Unit**: `countActiveAdmins` — correct count with various deactivated/deleted states
- [x] **Unit**: `listUsers` — pagination, search, role filter, status filter
- [x] **Unit**: `listInvites` — pagination, status filter, email filter, issuer join
- [x] **Unit**: `listAuditLog` — pagination, actor/target/action/date filters
- [x] **Unit**: self-operation block — `targetUserId === sessionUserId` → 403 on all four endpoints
- [x] **Unit**: last-admin block — demote/disable/delete/purge last admin → 409
- [x] **Unit**: hard-purge confirmation validation — mismatched confirmation or adminEmail → 400
- [x] **Unit**: hard-purge blocked when active jobs exist → 409
- [x] **Unit**: audit metadata enrichment — all entries include identifying email/name fields
- [x] **Integration**: last-admin `FOR UPDATE` lock — concurrent transaction test (two connections race to demote last two admins; one succeeds, one gets 409)
- [x] **Integration**: hard-purge cascade — verify all referencing tables cleaned; audit_log FKs set to NULL; audit entries with metadata preserved
- [x] **Integration**: disable user → next request returns 401 (session_version mismatch)
- [x] **Integration**: soft-delete user → next request returns 401; user hidden from default list; visible with `?status=deleted`
- [x] **Integration**: role change audit entry metadata contains `{ fromRole, toRole, targetEmail }`
- [x] **Integration**: invite create + revoke audit entries emitted from existing endpoints
- [x] **E2E**: admin creates invite → copies URL → second browser context redeems invite via OAuth → user created with invite role (**infrastructure risk: requires multi-user Playwright fixture**)
- [x] **E2E**: admin disables user → user's next request 401s
- [x] **E2E**: admin-only route guard — non-admin navigating to `/admin` redirected to `/dashboard`
- [x] **E2E**: self-operation buttons disabled on own row; server rejects self-targeted API calls
- [x] Place concurrent transaction + cascade tests in `test/integration/` (per `test-placement-persistence-backend.md`)

## Acceptance Criteria (refined)

- Admin-only pages return 403/redirect for non-admin
- Last-admin block verified with concurrent transaction test
- Hard-purge blocked when target has active jobs; unblocked when jobs clear
- Every admin action produces at least one audit_log row with correct actor + target + metadata (disable/delete/purge produce two: primary action + `session_force_logout`)
- Hard-purge confirmation server-enforced: both confirmation string and admin email validated
- All audit entries contain identifying info in metadata (self-contained after hard-purge)
- E2E covers: create invite → copy URL → (separate browser, separate account) redeem; admin disables user → user's next request 401s

## API Endpoint Summary

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/admin/users` | — | List users (paginated, filterable) |
| PATCH | `/admin/users/:id/role` | `{ role }` | Change user role |
| POST | `/admin/users/:id/disable` | — | Disable user |
| POST | `/admin/users/:id/enable` | — | Enable user |
| DELETE | `/admin/users/:id` | — | Soft-delete user |
| DELETE | `/admin/users/:id/purge` | `{ confirmation, adminEmail }` | Hard-purge user |
| GET | `/admin/invites` | — | List invites (paginated, filterable) |
| GET | `/admin/audit-log` | — | List audit entries (paginated, filterable) |

Existing endpoints modified (audit logging added):
- `POST /invites` — emits `admin_invite_issued`
- `DELETE /invites/:code` — emits `admin_invite_revoked`
- `GET /profile` — response includes `role` field

## Audit Action Types (full list after KZO-144)

| Action | Trigger | Emitted by |
|---|---|---|
| `admin_promote_cli` | CLI `npm run admin:promote` | KZO-143 (existing) |
| `admin_promote_startup` | INITIAL_ADMIN_EMAIL on boot | KZO-143 (existing) |
| `admin_promote_first_signin` | INITIAL_ADMIN_EMAIL first OAuth | KZO-143 (existing) |
| `admin_role_change` | Admin UI role dropdown | KZO-144 |
| `admin_disable_user` | Admin UI disable button | KZO-144 |
| `admin_enable_user` | Admin UI enable button | KZO-144 |
| `admin_delete_user` | Admin UI soft-delete | KZO-144 |
| `admin_hard_purge_user` | Admin UI hard-purge | KZO-144 |
| `admin_invite_issued` | `POST /invites` | KZO-144 (added to existing) |
| `admin_invite_revoked` | `DELETE /invites/:code` | KZO-144 (added to existing) |
| `session_force_logout` | Side-effect of disable/delete/purge | KZO-144 |

## Permissions Matrix

| Action | admin | member | viewer | demo |
|---|:-:|:-:|:-:|:-:|
| View `/admin/*` pages | yes | no | no | no |
| List users / invites / audit log | yes | no | no | no |
| Change user role | yes | no | no | no |
| Disable / enable user | yes | no | no | no |
| Soft-delete user | yes | no | no | no |
| Hard-purge user | yes | no | no | no |
| Create invite | yes | no | no | no |
| Revoke invite | yes | no | no | no |
| Self-demote / self-disable / self-delete / self-purge | blocked | n/a | n/a | n/a |

## Open Items

- [x] **Follow-up ticket**: hard-purge cascade extension for `portfolio_shares` (KZO-146) and `anonymous_share_tokens` (KZO-147) — create after those tables exist
- [x] **Infrastructure risk**: E2E multi-user invite redemption requires two Playwright browser contexts with different OAuth sessions; may surface fixture infrastructure work

## Out of Scope (explicitly deferred)

- Sharing UI / share grants (KZO-146)
- Anonymous share tokens (KZO-147)
- Impersonation (KZO-148)
- `/admin/settings` fill-in (KZO-142)
- `/admin/shares` page (rejected per parent epic scope-grill)
- Un-delete (restore soft-deleted user) — explicitly rejected; soft-delete is one-way toward hard-purge
- User-configurable sort on admin tables (MVP: `created_at DESC` only)
- Audit log retention / cleanup policy

## References

- Parent scope-todo: `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`
- Foundations scope-todo: `docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md`
- Linear: https://linear.app/kzokv/issue/KZO-144
- No debate note written — all questions resolved in Phase 1 grill
- Related rules: `migration-strategy.md`, `service-error-pattern.md`, `test-placement-persistence-backend.md`, `full-test-suite.md`, `implementer-qa-test-ownership.md`, `interface-caller-verification.md`
