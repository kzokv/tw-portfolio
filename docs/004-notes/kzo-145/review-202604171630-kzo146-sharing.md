---
slug: kzo-145
type: code-review
created: 2026-04-17
tickets: [KZO-145, KZO-146]
reviewer: Claude (code-reviewer skill)
target_branch: worktree-kzo-145
base_branch: dev
scope_reference: docs/004-notes/kzo-145/scope-todo-202604171530-share-grant-ui.md
---

# Code Review: KZO-146 Sharing Implementation (against KZO-145 locked scope)

Read-only structured review of the uncommitted changes on `worktree-kzo-145`: 21 modified files, 1,799 insertions. Implements portfolio sharing per the scope-todo locked seconds before this review.

**Verdict: Request changes** — one broken E2E, significant test-coverage gap (10 of 18 scope-required scenarios missing), and several correctness/consistency issues that will cause admin-audit UX regressions and edge-case bugs.

## Summary by severity

| Tier | Count |
|---|---|
| Critical | 0 |
| High | 5 |
| Medium | 10 |
| Low | 5 |
| Informational | 4 |

## Scope compliance checklist

| Scope item | Status | Notes |
|---|---|---|
| Q1: `/sharing` page + avatar-dropdown entry | Shipped | `apps/web/app/sharing/{layout,page}.tsx`, `UserAvatarButton.tsx:143-154` |
| Q1 gap-fix: viewer/demo inbound-only | Shipped | `SharingClient.tsx:76`, gating in `SharingClient.tsx:174-181,212-225` |
| Q2: `invites.share_owner_user_id` column | Shipped | `db/migrations/032_kzo146_sharing.sql:4-11` |
| Q2: `POST /shares` with role gate | Shipped | `registerRoutes.ts:1313-1376` |
| Q2: Self-share guard | Shipped | `registerRoutes.ts:1324-1326` |
| Q2: Rate-limit 10 pending invites | Partial | `registerRoutes.ts:1346-1349` — see H-3 for dedup-race |
| Q2: Dedup pending invites by email | Shipped | `memory.ts:494-508`, `postgres.ts:941-983` |
| Q2: OAuth callback share materialization | Shipped | `registerRoutes.ts:1213-1223` — see M-2 for fragility |
| Q3: Unified outbound table + history toggle | Shipped | `OutboundSharesTable.tsx`, `SharingClient.tsx:212-225` |
| Q3: Read-only inbound section | Shipped | `InboundSharesCards.tsx` (not re-verified in detail) |
| Q3: Grantee notification on grant + revoke | Partial | Stored in DB (`createNotificationTx`) + SSE event — see M-6 for i18n gap |
| Q4: `share_granted`/`share_revoked` audit actions | Shipped | Migration adds to CHECK, `buildShareAuditMetadata` emits |
| Q4: "Sharing" group filter in `/admin/audit-log` | Shipped | `AdminAuditLogClient.tsx` diff confirms |
| Q4: Self-contained audit metadata (hard-purge survival) | **Broken** | Metadata missing `targetEmail`; see H-2 |
| `requireShareGrantorRole` helper | Shipped | `registerRoutes.ts:521-525` |
| Hard-purge cascade FKs (`CASCADE`/`SET NULL`) | Shipped | Migration lines 15-17 |
| Architecture doc | Shipped | `docs/001-architecture/sharing.md` |
| AAA `SharesEndpoint` registered in mapper | Shipped | `libs/test-api/src/config/mapper.ts:19,37` |
| **18 AAA scenarios** | **Partial (44%)** | 7 HTTP + 1 UI = 8 of 18; see H-5 for gap list |

---

## Critical (0)

None.

---

## High (5)

### H-1. E2E spec expects test-ids that don't exist in any component

**File:** `apps/web/tests/e2e/specs/sharing-page-aaa.spec.ts:15-16`

```ts
await expect(page.getByTestId("sharing-outbound-section")).toBeVisible();
await expect(page.getByTestId("sharing-inbound-section")).toBeVisible();
```

Neither `sharing-outbound-section` nor `sharing-inbound-section` `data-testid` attribute exists in any file under `apps/web/components/sharing/` (verified by grep: 0 hits in `GrantShareDialog.tsx`, `ShareRevokeDialog.tsx`, `SharingClient.tsx`, `SharingRouteProvider.tsx`, `OutboundSharesTable.tsx` has 1 unrelated hit in InboundSharesCards.tsx). The spec will fail on every run.

**Fix:** Either add `data-testid="sharing-outbound-section"` to the outbound `<Card>` wrapper in `OutboundSharesTable.tsx` (and `sharing-inbound-section` in `InboundSharesCards.tsx`), OR change the spec to assert on testids that exist (`sharing-page`, `sharing-grant-button`, individual row test-ids).

### H-2. Sharing audit metadata breaks the `/admin/audit-log` "Target" column

**Files:**
- `apps/api/src/persistence/memory.ts:2306-2314`
- `apps/api/src/persistence/postgres.ts:216-228`

```ts
function buildShareAuditMetadata(shareId, owner, grantee) {
  return {
    owner_email: owner.email,
    owner_display_name: owner.display_name,
    grantee_email: grantee.email,
    grantee_display_name: grantee.display_name,
    share_id: shareId,
  };
}
```

The admin audit log adapter at `memory.ts:2234` derives the `targetEmail` column as:

```ts
targetEmail: (e.metadata?.targetEmail as string) ?? (e.metadata?.email as string) ?? null,
```

All other KZO-144 audit emissions use camelCase `targetEmail` (see `memory.ts:1982,2003,2009,2023,2042,2048,2065,2071` — `admin_role_change`, disable, enable, soft-delete, hard-purge all pass `targetEmail: user.email`). The sharing emissions use snake_case `grantee_email` instead, so the admin-audit UI's `targetEmail` column will render `null` for every `share_granted` and `share_revoked` entry.

Admin users filtering by grantee will see empty target cells and have to read the metadata string. Violates the KZO-144 "self-contained audit metadata" convention adopted by the rest of the audit log. Scope-todo §Q4 specifically calls out this convention: *"Self-contained metadata (matching the KZO-144 pattern of self-contained entries that survive hard-purge)"*.

**Fix:** Extend `buildShareAuditMetadata` to add `targetEmail: grantee.email` and `targetDisplayName: grantee.display_name` alongside the snake_case keys — or better, switch all sharing metadata to camelCase (`ownerEmail`, `granteeEmail`, `shareId`, `shareCoupled`, `shareOwnerEmail`) to match KZO-144. If switching keys, update `AdminAuditLogClient.tsx:63-68` to read camelCase variants.

### H-3. Rate-limit race with dedup blocks legitimate re-attachment

**File:** `apps/api/src/routes/registerRoutes.ts:1346-1356`

```ts
const activePendingInvites = await app.persistence.countActivePendingShareInvites(contextUserId);
if (activePendingInvites >= 10) {
  throw routeError(429, "share_invite_rate_limited", "share invite rate limited");
}

const invite = await app.persistence.createShareCoupledInvite({...});
```

`createShareCoupledInvite` implements dedup (memory:494-508, postgres:941-996): if an active pending invite exists for the target email — already owned by this caller OR unattached — the method updates `share_owner_user_id` in place without creating a new row.

But the rate-limit check runs **before** dedup: an owner at 10 active pending invites submitting `POST /shares { email: X }` where X is one of those 10 emails hits a 429 — even though no new row would be created. Same for attaching to an orphaned admin invite when at the cap.

**Fix:** Move rate-limit check inside `createShareCoupledInvite` AFTER the dedup SELECT, only enforcing when about to `INSERT` a new row. Or: have `countActivePendingShareInvites` exclude invites for emails the caller has intent for (messier).

### H-4. Metadata casing inconsistency across the audit log

Partial duplicate of H-2 but distinct scope. Sharing emits snake_case metadata keys (`owner_email`, `grantee_email`, `share_id`, `share_coupled`, `share_owner_email`) while every other audit emitter in the codebase uses camelCase (`targetEmail`, `fromRole`, `inviteCode`, `reason`, etc.). Evidence:

- Snake-case emitters: `memory.ts:449,482,634,689`, `postgres.ts:783,884,1336`, `registerRoutes.ts:1361-1367`
- Camel-case emitters (existing): `memory.ts:1982,2003,2042,2065`, `registerRoutes.ts:1055,1087,1174`

The `AdminAuditLogClient.tsx:63-68` formatMetadata reads snake-case for sharing but camelCase for everything else, cementing the inconsistency into the UI.

**Fix:** Standardize on camelCase throughout the sharing feature: helpers, routes, and the one `formatMetadata` branch. One-line migration since there are no external consumers.

### H-5. AAA test coverage gap — 10 of 18 scenarios missing (scope-todo §AAA E2E Scripts)

Scope-todo enumerated 12 HTTP + 6 UI scenarios. Delivered: 7 HTTP + 1 UI file (with 2 test cases).

**HTTP scenarios missing:**
1. `sharing-grant-dedup-existing-admin-invite-aaa.http.spec.ts` — admin invite pre-exists, owner attaches share intent, no new invite row
2. `sharing-grant-orphan-materialization-aaa.http.spec.ts` — user signed up via a different invite first; OAuth callback materializes pending share
3. `sharing-reshare-after-expired-aaa.http.spec.ts` — expired pending invite + re-share creates fresh pending
4. `sharing-rate-limit-aaa.http.spec.ts` — 11th pending invite returns 429
5. `sharing-hard-purge-cascade-aaa.http.spec.ts` — admin purges owner, `portfolio_shares` cascades, invite FK sets NULL

**UI E2E scenarios missing:**
6. `sharing-grant-pending-copy-url-aaa.spec.ts` — unknown-email flow → confirmation → copy-URL modal
7. `sharing-revoke-confirm-and-notification-aaa.spec.ts` — two-context: grantee sees notification after revoke
8. `sharing-viewer-landing-aaa.spec.ts` — viewer with no inbound sees landing copy
9. `sharing-viewer-with-inbound-aaa.spec.ts` — viewer with one inbound sees card, no outbound
10. `sharing-admin-audit-filter-aaa.spec.ts` — "Sharing" group filter surfaces share events in `/admin/audit-log`

Four of these cover the hardest code paths (orphan materialization, dedup, rate-limit, hard-purge-cascade) which are exactly the scope-todo's "gap fixes" #2, #3, and #4. Without these tests, the corresponding code paths are unverified.

**Fix:** Add the 5 missing HTTP specs before merging; UI specs can land in a follow-up PR if needed, but the HTTP coverage is load-bearing.

---

## Medium (10)

### M-1. `materializePendingSharesForEmail` over-filters on null `owner_email`

**Files:**
- `apps/api/src/persistence/postgres.ts:1280-1282`
- `apps/api/src/persistence/memory.ts:661-664`

```ts
// postgres
if (!invite.owner_user_id || !invite.owner_email) {
  continue;
}
```

Scope-todo §OAuth callback extension specifies *"Skip if `share_owner_user_id IS NULL` (owner was hard-purged; FK set to NULL)"*. Current code ALSO skips when `owner_email` is null — a user without an email (rare but possible). The share should still materialize; email is display-only.

Additionally, when skipping due to null owner, the invite is **not** marked `used_at = NOW()`. The orphan invite stays active until natural expiry, and subsequent OAuth resolutions for that email will repeatedly try to materialize it.

**Fix:** Filter only on `!invite.owner_user_id`. When skipping, also `UPDATE invites SET used_at = NOW() WHERE code = $1` to prevent repeated retries.

### M-2. OAuth callback wraps materialization in the main try/catch

**File:** `apps/api/src/routes/registerRoutes.ts:1213-1226`

```ts
} else { /* consume invite + create user */ }

const materializedShares = await app.persistence.materializePendingSharesForEmail({...});
for (const share of materializedShares) {
  await app.eventBus.publishEvent(authUser.userId, "sharing_notification", {...});
}
} catch {
  return errorRedirect("oauth_error");
}
```

Any failure in materialization (DB hiccup, constraint violation on a single pending share) redirects the user to `/auth/error?reason=oauth_error`. User creation already succeeded — the orphan shares are recoverable on next login — but the user sees a generic OAuth failure instead of being let in.

**Fix:** Wrap `materializePendingSharesForEmail` in its own try/catch; log the failure, let the user log in. The next OAuth cycle will retry materialization (see M-1's use_at fix).

### M-3. `SharesEndpoint` violates single responsibility

**File:** `libs/test-api/src/endpoints/SharesEndpoint.ts:57-89`

Methods `listAdminInvites`, `listAdminAuditLog`, `listNotifications` hit `/admin/invites`, `/admin/audit-log`, `/notifications` — none of which belong to the shares resource. The `NotificationsEndpoint` and a future `AdminEndpoint` already own those routes.

Downstream impact: other AAA specs that need admin-invite listing must either use `SharesEndpoint` (wrong resource) or re-implement the calls. `test-api-mapper-registration.md` requires one endpoint class per resource.

**Fix:** Move `listAdminInvites`/`listAdminAuditLog` into a dedicated `AdminEndpoint` and `listNotifications` into `NotificationsEndpoint` (it may already exist; dedupe).

### M-4. `SharesApiAssert.resolveBucket` silently fallbacks on inbound + pending/expired

**File:** `libs/test-api/src/assistants/shares/SharesApiAssert.ts:32-37`

```ts
if (section === "outbound") {
  return body.outbound[bucket];
}
return body.inbound[bucket === "active" || bucket === "revoked" ? bucket : "active"];
```

Calling `bucketContainsValue(body, "inbound", "pending", ...)` silently tests against `inbound.active`. The caller thinks they're checking pending invites on the inbound side (no such concept), but the assertion returns true/false based on `active`. Would pass or fail for the wrong reason.

**Fix:** Either restrict the `bucket` union type at the assertion method signature when `section === "inbound"`, or throw on unreachable branches (`throw new Error(`inbound has no '${bucket}' bucket`)`).

### M-5. `service.ts` defensive field fallbacks suggest unstable contract

**File:** `apps/web/features/sharing/service.ts:35,38,62,65`

```ts
const email = readString(value, "granteeEmail", "email", "targetEmail");
const createdAt = readString(value, "createdAt", "grantedAt", "issuedAt", "updatedAt") ?? ...;
```

The API response is a typed DTO (`ShareGrantDto`, `PendingShareInviteDto` in `shared-types`) — `granteeEmail` and `createdAt` are the only keys the backend emits. The fallbacks (`email`, `targetEmail`, `grantedAt`, `issuedAt`, `updatedAt`) are dead code and create the illusion the backend contract is fluid.

**Fix:** Type `fetchSharingPageData`/`createShareGrant` against `SharesListResponseDto` / `CreateShareResponseDto` directly. Drop the permissive `readString(...)` fallbacks.

### M-6. Notification body is English-only; ignores user locale

**File:** `apps/api/src/persistence/postgres.ts:241-248`, `memory.ts:2322-2330`

```ts
body: `${ownerLabel} shared their portfolio with you. Open the switcher to view.`,
```

Scope-todo §Q3 expects notifications for Chinese-locale users to be localized. The notification body is hard-coded English; a `zh-TW` user sees English in their notification bell. The frontend notification dropdown renders `notification.title` / `notification.body` directly without looking up i18n keys (per KZO-132 pattern).

**Fix:** Either (a) persist a notification-kind identifier (`source: "sharing.granted"` / `"sharing.revoked"`) and render localized copy on the client using i18n placeholders, or (b) look up the user's locale at emission time and build the localized string server-side. Option (a) is the KZO-132-compatible path.

### M-7. Notification/audit helpers duplicated between memory and postgres

**Files:**
- `apps/api/src/persistence/memory.ts:2306-2350` — 45 lines of notification/audit helpers
- `apps/api/src/persistence/postgres.ts:216-272` — 57 lines of near-identical helpers

Same strings, same shape, minor typing differences (snake_case vs camelCase fields on input). Violates DRY; any i18n or shape change (e.g. fixing M-6) requires two coordinated edits.

**Fix:** Move `buildShareAuditMetadata`, `buildShareGrantedNotification`, `buildShareRevokedNotification` to a shared module (e.g. `apps/api/src/persistence/shareHelpers.ts`). Parametrize the user shape by type alias.

### M-8. `service.ts revokePendingShare` has dead admin-fallback

**File:** `apps/web/features/sharing/service.ts:152-163`

```ts
try {
  await deleteJson(`/shares/pending/${inviteCode}`);
} catch (error) {
  if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
    await deleteJson(`/invites/${inviteCode}`);
    return;
  }
  throw error;
}
```

`DELETE /invites/:code` is admin-only (see `ADMIN_ROUTE_KEYS` in `registerRoutes.ts:302-313`). A non-admin member falling into this branch would get 403 and the error propagates anyway. The fallback is either unused (happy path) or causes a second failure. Remove it.

### M-9. `DELETE /shares/:id` loads full outbound list to find one share

**File:** `apps/api/src/routes/registerRoutes.ts:1397-1398`

```ts
const existingShares = await app.persistence.listSharesForOwner(contextUserId);
const targetShare = existingShares.active.find((record) => record.id === params.id);
```

The only reason is to capture `targetShare.granteeUserId` for the SSE event after revoke. For an owner with N active shares, this is O(N) work to find one row.

**Fix:** Add a `getShareById(shareId, ownerUserId)` persistence method that returns the single row. The revoke path itself already runs a SELECT FOR UPDATE in `revokeShareGrant` — the method could return the share row instead of void.

### M-10. `DELETE /shares/:id` missing `requireShareGrantorRole` defense-in-depth

**File:** `apps/api/src/routes/registerRoutes.ts:1394-1410`

Both `POST /shares` (line 1314) and `DELETE /shares/pending/:code` (line 1379) call `requireShareGrantorRole(req)`. `DELETE /shares/:id` does not; it relies solely on the persistence-layer `WHERE owner_user_id = $2` check.

In practice viewers/demo can't own shares, so this is mostly theoretical, but the inconsistency invites future drift. Matches the scope-todo's permissions matrix which says viewers have `n/a` for revoke.

**Fix:** Add `requireShareGrantorRole(req);` at line 1395. Cost: one line.

---

## Low (5)

### L-1. Dedup path emits `admin_invite_issued` audit even when no row created

**File:** `apps/api/src/routes/registerRoutes.ts:1357-1369`

When `createShareCoupledInvite` dedups onto an existing invite (updates `share_owner_user_id` in place), the route still emits `admin_invite_issued`. Semantically misleading — no invite was issued; intent was attached. Consider either skipping the audit on dedup or using a new action like `share_intent_attached`.

### L-2. POST /shares allows sharing with deactivated users

**File:** `apps/api/src/routes/registerRoutes.ts:1328-1329`

```ts
const existingUser = await app.persistence.getAuthUserByEmail(body.email);
if (existingUser && !existingUser.deletedAt) { /* create share */ }
```

Only filters `deletedAt`; a `deactivatedAt` user (disabled by admin per KZO-144) still gets a live `portfolio_shares` row but cannot log in to view it. Harmless but wasteful.

**Fix:** Change condition to `if (existingUser && !existingUser.deletedAt && !existingUser.deactivatedAt)`.

### L-3. Internal UUIDs surfaced in `ShareGrantDto`

**File:** `libs/shared-types/src/index.ts:332,335`

`ShareGrantDto.ownerUserId` and `granteeUserId` expose internal UUIDs to clients. These aren't the OAuth `sub` or the session subject, but internal enumeration is generally undesirable — grantees can see owner's internal ID and vice-versa.

Low severity because these IDs aren't used for auth anywhere client-side, but consider dropping them from the DTO unless the switcher UX (KZO-146) needs them.

### L-4. SSE event fires even when revokeShareGrant is a no-op

**File:** `apps/api/src/routes/registerRoutes.ts:1400-1406`

```ts
await app.persistence.revokeShareGrant(params.id, contextUserId, {...});
if (targetShare) {
  await app.eventBus.publishEvent(targetShare.granteeUserId, "sharing_notification", {...});
}
```

If the share was already revoked (idempotent no-op in persistence), no audit row is added and no DB notification row is created — but the route still publishes the SSE event because `targetShare` was found in the active list moments earlier. The grantee's client refetches `/notifications` and sees nothing new. Cosmetic.

### L-5. Self-share check uses stored `owner.email`

**File:** `apps/api/src/routes/registerRoutes.ts:1324-1326`

```ts
if (owner.email && normalizeEmailAddress(owner.email) === body.email) {
  throw routeError(400, "cannot_share_with_self", "...");
}
```

If `owner.email` is stale or null, the check could miss. Very edge-case — users can't change their own emails (KZO-143 locks email to the first OAuth claim) — but relying on the DB value rather than the session claim is mildly fragile. Acceptable for MVP.

---

## Informational (4)

### I-1. Migration uses `TEXT` not `UUID` — scope-todo was wrong

**File:** `db/migrations/032_kzo146_sharing.sql:5,15-17`

Scope-todo §Q2 said `UUID NULL REFERENCES users(id)`. Implementation correctly uses `TEXT` because `users.id` is TEXT throughout the codebase. Update the scope-todo reference to match reality — no code change needed.

### I-2. `SharingEndpoint.listNotifications` duplicates NotificationsEndpoint

**File:** `libs/test-api/src/endpoints/SharesEndpoint.ts:82-89`

Duplicates whatever `NotificationsEndpoint` already provides. Belongs to the consolidation discussed in M-3.

### I-3. `sharing.md` architecture doc uses camelCase metadata keys

**File:** `docs/001-architecture/sharing.md:149-154`

The architecture doc's metadata section lists camelCase (`ownerEmail`, `granteeEmail`, `shareId`) while the code emits snake_case. Whichever way H-2/H-4 resolves (camelCase recommended), the doc needs to match.

### I-4. `buildShareInviteUrl` uses `app.appBaseUrl` — consistent with existing invite paths

Good: `registerRoutes.ts:334` mirrors the pattern in `admin_invites` handler (line 1061). No issue, called out for clarity.

---

## Rule-file compliance matrix

| Rule | Status | Notes |
|---|---|---|
| `.claude/rules/service-error-pattern.md` | ✅ Pass | All new throws in persistence/routes use `routeError()` with correct status codes |
| `.claude/rules/migration-strategy.md` | ✅ Pass | New file `032_kzo146_sharing.sql`, not editing `030_kzo143_*.sql` |
| `.claude/rules/test-api-mapper-registration.md` | ✅ Pass | `SharesEndpoint` registered in mapper.ts:37 |
| `.claude/rules/test-placement-persistence-backend.md` | ⚠️ Unverified | HTTP specs run in oauth mode (correct) but hard-purge cascade test should be integration-backed — missing entirely (H-5) |
| `.claude/rules/nextjs-i18n-serialization.md` | ✅ Pass | `sharingI18n` uses `{email}`/`{date}` placeholders, no function values |
| `.claude/rules/e2e-seed-vs-reset-guards.md` | ✅ Pass | Test helpers use `createOauthSession`, not `__e2e/reset` — appropriate for oauth HTTP specs |
| `.claude/rules/provider-url-sanitization.md` | N/A | No provider image rendering in sharing UI |
| `.claude/rules/fastify-raw-streaming-cors.md` | N/A | Sharing routes use `reply.send()`, not raw streaming |
| `.claude/rules/interface-caller-verification.md` | ⚠️ Minor | New persistence methods are all called from `registerRoutes.ts` — no dead methods |
| `.claude/rules/replay-position-history-invariants.md` | N/A | Sharing doesn't recompute accounting state |

---

## Action list (top-down by severity)

Run these in order before merging:

1. **H-1** — Add `data-testid="sharing-outbound-section"` + `sharing-inbound-section` to the outbound table and inbound cards wrappers OR rewrite the E2E spec to use existing testids. Until fixed, E2E always red.
2. **H-2 / H-4** — Unify audit metadata on camelCase: update `buildShareAuditMetadata` in both persistence files + `AdminAuditLogClient.tsx:63-68` + `sharing.md`. Add `targetEmail` field so the admin audit log "Target" column populates.
3. **H-3** — Reorder rate-limit vs dedup: check rate limit only when about to INSERT a new invite row.
4. **H-5** — Add the 5 missing HTTP AAA specs (dedup, orphan-materialization, rate-limit, re-share, hard-purge-cascade). UI specs can follow in a separate PR if timeline is tight.
5. **M-1** — `materializePendingSharesForEmail`: filter only on null `share_owner_user_id`; mark skipped invites as used to prevent retry-loops.
6. **M-2** — Wrap materialization in its own try/catch so a partial failure doesn't block login.
7. **M-3 + I-2** — Move `listAdminInvites`/`listAdminAuditLog`/`listNotifications` off `SharesEndpoint` onto dedicated endpoint classes.
8. **M-4** — Restrict or throw in `SharesApiAssert.resolveBucket` for invalid inbound buckets.
9. **M-5** — Type `fetchSharingPageData` against `SharesListResponseDto`; drop defensive key fallbacks.
10. **M-6** — Replace hard-coded notification strings with locale-aware emission or client-side template keys.
11. **M-7** — Consolidate sharing helpers into one shared module across memory/postgres.
12. **M-8** — Delete the `revokePendingShare` admin-endpoint fallback branch.
13. **M-9** — Add a dedicated `getShareById` persistence method (or return share from `revokeShareGrant`) to avoid full-list fetches.
14. **M-10** — Add `requireShareGrantorRole(req);` to `DELETE /shares/:id`.
15. **L-1 through L-5** and **I-1 through I-4** — address opportunistically.

Once H-1 through H-5 are resolved and the test suite is green, this is mergeable. M-tier items are important but not blocking.
