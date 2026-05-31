---
slug: kzo-145
source: scope-grill
created: 2026-04-17
tickets: [KZO-145, KZO-146]
required_reading:
  - docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md
  - docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md
  - docs/004-notes/kzo-144/scope-todo-202604170218-admin-portal.md
superseded_by: null
---

# Todo: KZO-145 — User-to-user share grant UI (scope-grill resolution)

> **For agents starting a fresh session:** read all files in `required_reading`. KZO-143 (foundations) and KZO-144 (admin portal) are complete/merged. This todo resolves the four open design questions flagged by KZO-145 (pre-ticket) and extends KZO-146 (KZO-141c) with the locked decisions.

Parent epic: KZO-141. KZO-145 is the scoping ticket; KZO-146 is the implementation ticket that consumes these decisions.

## Visual mock-up

- `docs/004-notes/kzo-145/mockup-sharing-page.html` — rendered layout of `/sharing` (Tailwind CDN, open in a browser)
- `docs/004-notes/kzo-145/mockup-sharing-page.png` — static screenshot of the same

## Locked Decisions

### Q1 — Owner share-grant UI location

**Dedicated `/sharing` page**, linked from the avatar dropdown (below "Admin", above "Sign out").

- Server-side layout guard in `/sharing/layout.tsx` — mirrors `/admin/layout.tsx`. Reads profile; no redirect, but conditionally renders sections.
- Visibility rules:
  - `role IN (admin, member) AND NOT is_demo` → full page: outbound grant form + outbound table + inbound section
  - `role = viewer OR is_demo = true` → page renders with **inbound section only** (subsumes KZO-146's "viewer landing page when no shares exist" deliverable)
- Avatar dropdown link visible for all non-demo users (label: "Sharing"); hidden for demo users (they have random emails; no grant path).

### Q2 — Grantee-not-yet-a-user flow

**Auto-issue invite coupled with share grant** (Shape A: invite-with-intent on the existing `invites` table).

**Schema additions (KZO-146 migration `032_kzo146_sharing.sql`):**
- `ALTER TABLE invites ADD COLUMN share_owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`
- Partial index: `CREATE INDEX idx_invites_share_pending ON invites(share_owner_user_id) WHERE share_owner_user_id IS NOT NULL AND used_at IS NULL AND revoked_at IS NULL` (supports per-owner rate-limit count)
- `CREATE TABLE portfolio_shares (...)` per KZO-146 scope, with cascade clauses:
  - `owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `grantee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `revoked_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`
  - `UNIQUE INDEX (owner_user_id, grantee_user_id) WHERE revoked_at IS NULL` (partial)
- `ALTER TABLE audit_log` CHECK constraint: add `share_granted`, `share_revoked` to the action enum

**New endpoint `POST /shares`:**
- Permission: `requireShareGrantorRole(req)` helper → `role IN (admin, member) AND NOT is_demo`; else `403 share_grant_forbidden`
- Body: `{ email }`
- Self-share guard: if `email.toLowerCase() === contextUserId's email` → `400 cannot_share_with_self`
- Resolution:
  - **Known user** (users row exists for email, not deleted) → insert `portfolio_shares` row; emit `share_granted` audit with metadata `{ owner_email, owner_display_name, grantee_email, grantee_display_name, share_id }`; emit grantee notification (see below)
  - **Unknown email** → check rate limit (max 10 active pending share-coupled invites per owner); reject with `429 share_invite_rate_limited` if exceeded
  - **Unknown email, under rate limit** →
    - Dedup: if an active pending invite exists for this email, `UPDATE invites SET share_owner_user_id = :owner WHERE code = :existing_code`; no new invite issued
    - Else: insert new invite with `share_owner_user_id = :owner`, `role = 'viewer'` (forced — caller role is ignored), `expires_at = NOW() + 7 days`; emit `admin_invite_issued` audit with metadata `{ share_coupled: true, share_owner_email, share_owner_display_name, target_email, invite_code, role }`
  - Response shape: `{ type: "resolved", share: { ... } }` OR `{ type: "pending", invite: { code, url, expiresAt } }`

**New endpoint `DELETE /shares/:id`:**
- Permission: owner-only (`owner_user_id === contextUserId`). Admins cannot revoke others' shares (lever = disable user).
- Sets `revoked_at = NOW()`, `revoked_by_user_id = contextUserId`; idempotent; 204
- Emits `share_revoked` audit with full metadata (same enrichment shape as grant)
- Emits grantee notification

**New endpoint `GET /shares`:**
- Permission: any authenticated user
- Response: `{ outbound: { active, pending, expired, revoked }, inbound: { active, revoked } }` — server filters rows belonging to `contextUserId` in each direction
- No pagination in MVP; revisit if needed

**OAuth callback extension (`apps/api/src/auth/googleOAuth.ts`):**
After user resolution (new or existing), scan active pending share-coupled invites for this email:
```sql
SELECT * FROM invites
WHERE email = :email
  AND share_owner_user_id IS NOT NULL
  AND used_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > NOW()
```
For each match:
1. Skip if `share_owner_user_id IS NULL` (owner was hard-purged; FK set to NULL)
2. Insert `portfolio_shares(owner_user_id, grantee_user_id, ...)` — collision with active share? Ignore / on-conflict-do-nothing
3. Mark invite `used_at = NOW()` (only if this is also the invite the user is consuming; else leave `used_at = NULL` — share materializes but invite code stays reusable until its own expiry for pure user creation). **Simpler rule:** mark all matched invites as used at this consume step to avoid orphaned reusable codes.
4. Emit `share_granted` audit per materialized share

This handles three races: (a) grantee signed up via admin invite before consuming share-coupled one, (b) multiple owners issued pending shares to same email, (c) duplicate email dedup edge cases.

**Delivery:** no mail server → copy-URL UX. Confirmation dialog before auto-issuing invite: "{email} isn't registered yet. We'll create a viewer invite link for you to send them. Continue?" On confirm, modal shows the invite URL with copy button + sign-in-with-Google instructions.

### Q3 — Revoke UX

**Single `/sharing` page with unified outbound table + read-only inbound section.**

**Outbound table:**
| Grantee | Status | Created | Expires | Actions |
|---|---|---|---|---|
| `alice@example.com` (Alice Smith) | **Active** | 2026-04-01 | — | `Revoke` |
| `bob@example.com` (not registered) | **Pending** | 2026-04-14 | 2026-04-21 | `Copy URL` · `Revoke` |
| `carol@example.com` (not registered) | **Expired** | 2026-03-20 | 2026-03-27 | `Re-share` |

- Revoked rows hidden by default; `Show history` toggle reveals them (read-only, no actions).
- Confirmation dialogs:
  - Active revoke: "Revoke access for {email}? They'll immediately lose access to your portfolio."
  - Pending revoke: "Cancel pending invite for {email}? If they haven't signed up yet, the link will stop working."
- Active revoke → `DELETE /shares/:id` → immediate 403 on grantee's next read, toast + switcher reset (KZO-146 mechanism)
- Pending revoke → `DELETE /invites/:code` (existing endpoint); metadata carries `{ share_coupled: true, share_owner_email }` from the join. Emits `admin_invite_revoked` (existing enum, no new action).
- `Re-share` (expired rows) → reopens grant form pre-filled with the email; creates a fresh pending invite; old expired row stays in history.
- **No Edit action** — role is fixed to viewer; re-grant via revoke + new grant.

**Inbound section (below outbound):**
- Card list: "Portfolios shared with you"
- Each card: owner email, owner display name, granted-at, switcher-link ("View portfolio")
- Read-only — grantees can't self-revoke (owners revoke; grantee drops entry by not selecting it in switcher)
- Empty state for viewers / anyone with no inbound shares: "No portfolios have been shared with you yet. Ask a member or admin to share their portfolio with you." (subsumes KZO-146's "Viewer landing page when no shares exist.")

**Grantee notifications (new):**
- Shape: `NotificationDto` with `source = "sharing"`, `sourceRef = share.id`, `severity = "info"`
- On **grant** (share materializes — direct or via pending-invite consume):
  - Title: "Portfolio shared with you"
  - Body: "{owner_display_name || owner_email} shared their portfolio with you. Open the switcher to view."
  - `detail: { ownerUserId, ownerEmail, ownerDisplayName, shareId }`
- On **revoke**:
  - Title: "Portfolio access revoked"
  - Body: "{owner_display_name || owner_email} revoked your access to their portfolio."
  - `detail: { ownerUserId, ownerEmail, ownerDisplayName, shareId }`
- Delivered via existing SSE infra (`useEventStream` pre-connect per `react-useEventStream-preconnect-pattern.md`)
- i18n strings use template placeholders (`{owner}`, `{share_id}`), never function values (per `nextjs-i18n-serialization.md`)

### Q4 — Admin visibility

**Audit-log-only, no `/admin/shares` page.**

- New audit actions in KZO-146 migration: `share_granted`, `share_revoked`
- Metadata enrichment (self-contained per KZO-144 pattern): `{ owner_email, owner_display_name, grantee_email, grantee_display_name, share_id }`
- Share-coupled invites carry `share_coupled: true` + `share_owner_email` + `share_owner_display_name` in the existing `admin_invite_issued` / `admin_invite_revoked` metadata (no new enum values)
- **`share_granted` emission point:** at share materialization — either inside `POST /shares` resolved-user path, or inside OAuth-callback share-coupled-invite consumer. Never at form-submit time when path is pending.
- `/admin/audit-log` UI: add "Sharing" group to the grouped action filter (matches KZO-144 step H structure). Checkbox selects `share_granted` + `share_revoked`.
- No admin-side revoke endpoint. Lever against compromised owner = `POST /admin/users/:id/disable` (existing).

---

## KZO-146 scope additions (extends KZO-141c)

These items extend KZO-146's locked scope and must land together with the migration/endpoints:

### Database (migration `032_kzo146_sharing.sql`)
- [x] `CREATE TABLE portfolio_shares` with `owner_user_id / grantee_user_id ON DELETE CASCADE`, `revoked_by_user_id ON DELETE SET NULL`, partial unique index on `(owner, grantee) WHERE revoked_at IS NULL`
- [x] `ALTER TABLE invites ADD COLUMN share_owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`
- [x] `CREATE INDEX idx_invites_share_pending ...` (partial, for rate-limit count)
- [x] `ALTER TABLE audit_log` CHECK constraint: add `share_granted`, `share_revoked`

### Persistence layer (libs/domain + apps/api/src/persistence)
- [x] `createShareGrant(ownerUserId, granteeUserId, auditInput)` — transactional insert + audit + notification
- [x] `revokeShareGrant(shareId, revokedByUserId, auditInput)` — transactional update + audit + notification (now returns `{ granteeUserId } | null` for efficient SSE gating)
- [x] `createShareCoupledInvite({ ownerUserId, email, expiresAt })` — insert invite row with `share_owner_user_id` set, `role='viewer'`; dedup against existing pending invite for email
- [x] `countActivePendingShareInvites(ownerUserId)` → int (for rate limit check)
- [x] `listSharesForOwner(ownerUserId)` → `{ outbound: { active[], pending[], expired[], revoked[] } }`
- [x] `listInboundSharesForGrantee(granteeUserId)` → `{ active[], revoked[] }`
- [x] `materializePendingSharesForEmail(userId, email)` — OAuth callback helper; inserts portfolio_shares + marks invites used + emits audit
- [x] `requireShareGrantorRole(req)` helper — inlined in `apps/api/src/routes/registerRoutes.ts:521` rather than a separate `helpers/` file; functional, but file location differs from scope-todo suggestion

### API routes
- [x] `POST /shares` — `{ email } → { type: "resolved" | "pending", ... }`; `requireShareGrantorRole`
- [x] `DELETE /shares/:id` — owner-only; idempotent; 204
- [x] `GET /shares` — authenticated; returns outbound + inbound shape
- [x] `DELETE /invites/:code` metadata enrichment: include `shareCoupled: true` + owner info when applicable (camelCase applied per review H-4)
- [x] Audit emission inside service methods (matches KZO-144 pattern)
- [x] **Bonus:** owner-scoped `DELETE /shares/pending/:code` added to avoid granting members DELETE on admin invites endpoint (per AAA scenario #6 implementation-note)

### OAuth callback extension (`apps/api/src/routes/registerRoutes.ts` — not a separate `googleOAuth.ts` file)
- [x] After user resolution (new or existing), scan active pending share-coupled invites for this email; for each: insert `portfolio_shares` + mark invite used + emit `share_granted`; skip if `share_owner_user_id IS NULL` (owner purged). Wrapped in its own try/catch so partial materialization failure does not block login (per review M-2).

### Web — routes + components
- [x] `apps/web/app/sharing/layout.tsx` — server component; loads profile; renders `AppShell` wrapper
- [x] `apps/web/app/sharing/page.tsx` — client; renders SharingClient component
- [x] `apps/web/components/sharing/SharingClient.tsx` — main container; outbound + inbound sections
- [x] `apps/web/components/sharing/GrantShareDialog.tsx` — modal with email input, confirmation step, copy-URL success step
- [x] `apps/web/components/sharing/OutboundSharesTable.tsx` — unified table (active / pending / expired) + history toggle
- [x] `apps/web/components/sharing/InboundSharesCards.tsx` — inbound read-only cards
- [x] `apps/web/components/sharing/ShareRevokeDialog.tsx` — reuse existing `ConfirmDialog` with variant copy
- [x] `apps/web/features/sharing/i18n.ts` — string-template dictionaries (no function values), en + zh-TW
- [x] `apps/web/components/profile/UserAvatarButton.tsx` — conditional "Sharing" link visible to all non-demo users
- [x] `apps/web/proxy.ts` — `/sharing/*` is protected by default via the existing allow-list (`isPublicPath`) pattern; no explicit edit needed (scope-todo overspecified)

### Notifications
- [x] Notification emission on grant + revoke — `NotificationDto` with `source = "sharing"`, `sourceRef = share.id`, `severity = "info"`
- [ ] **Not delivered:** i18n for notification titles/bodies. Server emits English-only strings (`"Portfolio shared with you"` / `"Portfolio access revoked"`) via `shareHelpers.ts`. Consistent with existing notification system behavior (KZO-132), but a zh-TW locale user sees English. Deferred — belongs with a repo-wide notification-i18n pass.

### Admin UI extension (KZO-144 follow-up in same PR or immediately after)
- [x] `AdminAuditLogClient.tsx` — "Sharing" action group added to filter UI; maps to `share_granted,share_revoked`; metadata formatter handles both resolved (`ownerEmail → granteeEmail`) and share-coupled (`shareOwnerEmail → targetEmail`) cases

### Documentation
- [x] New doc: `docs/001-architecture/sharing.md` — data model, flows, write-path guards, notification shapes
- [x] Update `docs/001-architecture/backend-db-api.md` — `portfolio_shares` table + `invites.share_owner_user_id` column referenced
- [x] Update `docs/001-architecture/auth-and-session.md` — OAuth callback share-materialization path referenced

---

## AAA E2E Scripts

Each scenario below becomes an AAA triplet. HTTP-layer tests live in `apps/api/test/http/specs/` (AUTH_MODE=oauth); UI E2E live in `apps/web/tests/e2e/specs/` (dev_bypass). Scenarios cross-layer should be split into two scripts.

**New AAA endpoint + assistant pairs required:**
- [x] `SharesEndpoint` + `SharesApiAssistant` (libs/test-api/src/endpoints + assistants) — registered in `libs/test-api/src/config/mapper.ts`
- [x] **Bonus:** `AdminEndpoint` + `AdminApiAssistant` split out for SRP (sharing specs originally had admin endpoints collocated on SharesEndpoint — moved per review M-3)
- [x] `SharingPage` + `SharingAssistant` under `libs/test-e2e/src/{pages,assistants}/sharing/` — registered in `libs/test-e2e/src/config/mapper.ts`; exposed via the `sharing` fixture on `TAppPagesFixtures`

### HTTP-layer (API contract) — 12/12 delivered

1. [x] **sharing-grant-known-user-aaa.spec.ts**
   - Arrange: seed owner + grantee users (distinct emails); owner authenticated
   - Actions: `POST /shares { email: grantee.email }`
   - Assert: 201, response `{ type: "resolved", share: ... }`; `GET /shares` from owner lists active outbound; `GET /shares` from grantee lists active inbound; `share_granted` audit row with full metadata

2. [x] **sharing-grant-unknown-email-pending-aaa.spec.ts**
   - Arrange: owner authenticated; email `bob@new.com` with no existing user
   - Actions: `POST /shares { email: "bob@new.com" }`
   - Assert: 201, response `{ type: "pending", invite: { code, url, expiresAt } }`; invites row has `share_owner_user_id = owner`, `role = 'viewer'`; `admin_invite_issued` audit with `share_coupled: true`

3. [x] **sharing-grant-dedup-existing-admin-invite-aaa.spec.ts**
   - Arrange: admin-issued pending invite exists for `bob@new.com` with `role = member`; no user
   - Actions: owner calls `POST /shares { email: "bob@new.com" }`
   - Assert: 201 pending; existing invite row updated in place — `share_owner_user_id` now set; `role` unchanged at `member`; code unchanged; no second invite row

4. [x] **sharing-grant-orphan-materialization-aaa.spec.ts**
   - Arrange: owner issues pending share-coupled invite for `bob@new.com`; separately, admin issues admin invite for same email; Bob consumes admin invite and signs up (user created)
   - Actions: Bob's OAuth callback completes (admin invite consumed)
   - Assert: share-coupled invite detected in post-user-resolution scan → `portfolio_shares` row inserted, share-coupled invite marked `used_at = NOW()`, `share_granted` audit emitted; grantee notification row present for Bob

5. [x] **sharing-revoke-active-aaa.spec.ts**
   - Arrange: owner + grantee; active share exists
   - Actions: `DELETE /shares/:id` as owner
   - Assert: 204; `portfolio_shares.revoked_at` set, `revoked_by_user_id = owner`; `share_revoked` audit row; grantee's `GET /shares` no longer lists inbound; `NotificationDto` for grantee with `source = "sharing"`, title = "Portfolio access revoked"

6. [x] **sharing-revoke-pending-aaa.spec.ts**
   - Arrange: owner has active pending share-coupled invite
   - Actions: `DELETE /invites/:code` as owner (via Admin? or new owner-scoped endpoint? — need clarification; MVP: admin-only DELETE /invites, so owner revoke of pending share goes through a dedicated path or `DELETE /shares/:pendingId`)
   - Assert: invite `revoked_at` set; `admin_invite_revoked` audit with `share_coupled: true` metadata; subsequent OAuth consume of that code redirects to `/auth/error?reason=revoked`

   > **Implementation note:** MVP might need owner-scoped `DELETE /shares/pending/:code` to avoid granting members DELETE on the admin invites endpoint. Decide during implementation; locked semantics (revoke allowed) are clear.

7. [x] **sharing-reshare-after-expired-aaa.spec.ts**
   - Arrange: owner has expired pending share-coupled invite for `carol@new.com`
   - Actions: `POST /shares { email: "carol@new.com" }`
   - Assert: new pending invite created (new code); old expired row untouched; outbound list shows one active pending

8. [x] **sharing-viewer-blocked-aaa.spec.ts**
   - Arrange: user with `role = viewer`
   - Actions: `POST /shares { email: "anyone@x.com" }`
   - Assert: 403 `share_grant_forbidden`

9. [x] **sharing-demo-blocked-aaa.spec.ts**
   - Arrange: user with `is_demo = true, role = member`
   - Actions: `POST /shares`
   - Assert: 403 `share_grant_forbidden`

10. [x] **sharing-rate-limit-aaa.spec.ts**
    - Arrange: owner with 10 active pending share-coupled invites
    - Actions: `POST /shares { email: "eleventh@new.com" }`
    - Assert: 429 `share_invite_rate_limited`; no new invite row

11. [x] **sharing-self-share-aaa.spec.ts**
    - Arrange: authenticated owner
    - Actions: `POST /shares { email: owner.email }`
    - Assert: 400 `cannot_share_with_self`; no rows created

12. [x] **sharing-hard-purge-cascade-aaa.spec.ts** (integration — Postgres-backed)
    - Arrange: owner + grantee + active share; owner has active pending share-coupled invite for third email
    - Actions: admin hard-purges owner
    - Assert: `portfolio_shares` row DELETED (cascade); pending invite's `share_owner_user_id` set to NULL (SET NULL); OAuth consume of that invite would skip share-creation (no FK crash)

### UI E2E (user journey) — 6/6 delivered

13. [x] **sharing-grant-flow-aaa.spec.ts** (dev_bypass)
    - Arrange: authenticated member on `/sharing`
    - Actions: click "Share your portfolio" → enter known user email → confirm dialog → submit
    - Assert: new row in outbound table, status = Active; toast "Shared with {email}"

14. [x] **sharing-grant-pending-copy-url-aaa.spec.ts** (dev_bypass)
    - Arrange: authenticated member on `/sharing`
    - Actions: enter unknown email → confirmation dialog ("not registered yet...") → confirm → copy-URL modal appears
    - Assert: modal shows full invite URL `{WEB_BASE_URL}/invite/{code}`; Copy button writes to clipboard; outbound table gains Pending row

15. [x] **sharing-revoke-confirm-and-notification-aaa.spec.ts** (dev_bypass; owner UI + grantee HTTP impersonation, not two browser contexts — covers the Assert outcome without the multi-context overhead)
    - Arrange: seed grantee via `/__e2e/oauth-session`; seed share via `POST /shares`
    - Actions: navigate to `/sharing` → click Revoke row → confirm revoke dialog
    - Assert: outbound row hidden; grantee's `GET /notifications` contains `source="sharing"` + title "Portfolio access revoked"

16. [x] **sharing-viewer-landing-aaa.spec.ts** (dev_bypass with `tw_e2e_user_role=viewer` cookie → `x-user-role` header forwarding)
    - Arrange: viewer with no inbound shares navigates to `/sharing`
    - Assert: `sharing-role-note` visible; outbound grant button + outbound section hidden; `sharing-inbound-empty` visible

17. [x] **sharing-viewer-with-inbound-aaa.spec.ts** (dev_bypass)
    - Arrange: viewer with one active inbound share
    - Assert: inbound card displays owner info; no outbound sections rendered

18. [x] **sharing-admin-audit-filter-aaa.spec.ts** (dev_bypass)
    - Arrange: admin on `/admin/audit-log` with share_granted entry present
    - Actions: toggle filters + click `action-filter-share_granted`
    - Assert: audit-log-table contains "Granted share" + grantee email

---

## Delivery summary (cross-checked 2026-04-17 post-implementation)

**Delivered (40 items):**
- Database: 4/4
- Persistence: 8/8
- API routes: 5/5 + 1 bonus (`DELETE /shares/pending/:code`)
- OAuth callback: 1/1
- Web routes/components: 10/10
- Notification emission: 1/1
- Admin UI: 1/1
- Documentation: 3/3
- AAA endpoint/assistant pairs: 2/2 + 1 bonus (`AdminEndpoint` + `AdminApiAssistant` split out per code review)
- HTTP AAA specs: 12/12
- UI E2E AAA specs: 6/6
- Infrastructure: `tw_e2e_user_role` cookie → `x-user-role` header forwarding in `apps/web/lib/api.ts` (enables viewer-role UI tests); new test tsconfig at `apps/api/test/tsconfig.json` + root typecheck script (catches HTTP spec type errors that previously slipped past `npm run typecheck`)

**Not delivered (1 item):**
- Notification i18n — server emits English-only strings via `shareHelpers.ts`. Consistent with existing notification system behavior (KZO-132); a zh-TW locale user sees English. Deferred — belongs with a repo-wide notification-localization pass.

**Post-implementation changes from `/code-reviewer` review** (`docs/004-notes/kzo-145/review-202604171630-kzo146-sharing.md`):
- H-2/H-4: audit metadata unified to camelCase + `targetEmail`/`targetDisplayName`
- H-3: rate-limit moved inside `createShareCoupledInvite` after dedup SELECT
- M-1: materialize filter fixed + invite marked used on orphan-owner skip
- M-2: materialize wrapped in its own try/catch
- M-3: `SharesEndpoint` SRP cleanup — admin/notification methods split onto new `AdminEndpoint` / existing `NotificationsEndpoint`
- M-4: `SharesApiAssert.resolveBucket` throws on invalid inbound buckets
- M-5/M-8: `service.ts` typed against DTOs, dead fallbacks removed
- M-7: share helpers consolidated into `shareHelpers.ts`
- M-9/M-10: `revokeShareGrant` returns grantee on flip; `requireShareGrantorRole` added to `DELETE /shares/:id`
- L-2: `POST /shares` filters deactivated users
- Infrastructure: new `apps/api/test/tsconfig.json` + rules updated so HTTP specs can no longer slip past typecheck (prevents the discriminated-union bug caught post-review in `sharing-grant-dedup-existing-admin-invite-aaa.http.spec.ts` and 5 sibling specs)

## Open Items

- Notification i18n — follow-up at repo-wide notification-localization scope
- Legacy test drift under `apps/api/test/{integration,unit}/` surfaced when the new test tsconfig was briefly widened (~14 pre-existing type errors) — separate cleanup ticket
- Scope-grill's downstream clarification (owner-scoped pending-share revoke endpoint path) resolved by delivering `DELETE /shares/pending/:code`

## Out of Scope (explicitly rejected)

- `/admin/shares` rollup page (Q4 outcome)
- Admin cross-user share revoke (lever = disable user)
- Edit share action (role is fixed to viewer; re-grant via revoke + new grant)
- Grantee self-revoke (switcher drop-out is the mechanism)
- Pagination on `/sharing` outbound/inbound in MVP (revisit if scale demands)
- Email delivery (no mail server configured; copy-URL only)
- Elevating auto-issued invites beyond `role = viewer`
- New notification enum/kind — reuse `NotificationDto` with `source = "sharing"`

## References

- Parent scope-todo (epic): `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`
- Foundations: `docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md`
- Admin portal: `docs/004-notes/kzo-144/scope-todo-202604170218-admin-portal.md`
- Linear: KZO-145 (this scope-grill), KZO-146 (implementation consumer)
- Mock-up HTML: `docs/004-notes/kzo-145/mockup-sharing-page.html`
- Mock-up PNG: `docs/004-notes/kzo-145/mockup-sharing-page.png`
- Related rules: `migration-strategy.md`, `service-error-pattern.md`, `test-api-mapper-registration.md`, `test-placement-persistence-backend.md`, `playwright-oauth-cookie-patterns.md`, `nextjs-i18n-serialization.md`, `react-useEventStream-preconnect-pattern.md`, `interface-caller-verification.md`

## Permissions Matrix (sharing surfaces)

| Action | admin | member | viewer | demo (member) |
|---|:-:|:-:|:-:|:-:|
| View `/sharing` (at all) | yes | yes | yes (inbound-only) | yes (inbound-only) |
| `POST /shares` (grant) | yes | yes | no (403) | no (403) |
| `DELETE /shares/:id` (own) | yes (own) | yes (own) | n/a (can't grant) | n/a |
| `GET /shares` | yes | yes | yes (inbound-only rendered) | yes |
| See `Sharing` link in avatar dropdown | yes | yes | yes | no |
| Admin revoke of others' shares | no | no | no | no |
| See `share_granted` / `share_revoked` in `/admin/audit-log` | yes | n/a | n/a | n/a |
