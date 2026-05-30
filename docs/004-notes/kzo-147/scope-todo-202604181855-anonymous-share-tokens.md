---
slug: kzo-147
source: scope-grill
created: 2026-04-18
tickets: [KZO-147]
required_reading: [docs/004-notes/kzo-147/mockup-anonymous-share.html]
superseded_by: null
---

# Todo: KZO-147 — Anonymous share tokens (public read-only route)

> **For agents starting a fresh session:** this scope-todo is the sole handoff. Read the mock-up at
> `docs/004-notes/kzo-147/mockup-anonymous-share.html` (and the rendered PNG) before implementing UI.
> Parent epic KZO-141; siblings KZO-143/144/145/146 are done and ship the foundations this ticket builds on.

## Context

KZO-147 is the "141d" child of the users/roles/sharing epic. It delivers public, unauthenticated,
read-only portfolio snapshots behind an opaque token URL. Owners mint tokens from the existing
`/sharing` page (shipped in KZO-145); viewers visit `/share/{token}` on the web app.

**Depends on (merged):** KZO-143 (role, audit_log, rate-limit pattern, `requireShareGrantorRole`
precursors), KZO-144 (audit_log action-check ALTER, admin audit UI filter groups), KZO-145
(`portfolio_shares`, `/shares` endpoints, `requireShareGrantorRole`, `/sharing` page Section A/B,
audit action extension pattern), KZO-146 (`requireSessionUserId` helper, `requireWriteableContext`
guard, `WRITE_CONTEXT_GUARD_ROUTE_KEYS` wiring).

**Blocks:** KZO-149 (hard-purge cascade extension — trivial memory-persistence one-liner after this
merges; Postgres side is automatic via `ON DELETE CASCADE`).

## Locked Decisions

### Q1 — Public-route DTO shape

- **Dedicated DTOs, not inline-scrub** — new `PublicShareView` type; no reuse of `HoldingsRow`
  (which has `costBasisAmount`). Type-level guarantee that cost basis never leaks.
- **Return metric: since inception** (single number). Not a range picker.
- **Multi-currency:** per-currency rows, not converted to a single base. Both
  `totalValueByCurrency` and `returnByCurrency` arrays.
- **Owner display name visible** with fallback chain: `display_name` → email-prefix → "Portfolio owner".
- **Filter zero-quantity holdings.**
- **Sort holdings by market value DESC.**
- **DTO shape:**
  ```ts
  type PublicShareView = {
    ownerDisplayName: string;
    expiresAt: string;
    holdings: Array<{
      ticker: string;
      quantity: number;
      marketValueAmount: number;
      marketValueCurrency: string;
      allocationPercent: number;  // 0..100, 2dp
    }>;
    summary: {
      totalValueByCurrency: Array<{ currency: string; amount: number }>;
      returnByCurrency: Array<{ currency: string; returnPercent: number }>;
    };
    quoteAsOf: string | null;
  };
  ```

### Q2 — Web rendering architecture

- **Next.js server component** at `apps/web/app/share/[token]/page.tsx`. Pure SSR, no client JS for
  data fetch.
- `export const dynamic = "force-dynamic"`.
- **Do NOT** add `/share/*` to `apps/web/proxy.ts` authenticated-routes list.
- Server component MUST NOT use `cookies()` from `next/headers`. No auth headers forwarded to API.
- On 404 from API → `notFound()` from `next/navigation` (Next serves its 404 page with proper status).
- Response headers: `Cache-Control: private, no-store, max-age=0`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`.
- `<head>`: `<meta name="robots" content="noindex, nofollow">`, `<meta property="og:title" content="Portfolio snapshot">` (no `og:image`).
- 404 copy: *"This link is not available. It may have expired, been revoked, or the URL may be incorrect."*

### Q3 — Owner UI placement (`/sharing` Section C)

- **Third section** on existing `/sharing` page, below Outbound and Inbound (see mock-up State 3).
- List columns: Link (truncated token + Copy button) | Created | Expires | Status | Actions.
- Token display: first 4 chars + `…` + last 4 chars; full URL via Copy button.
- Retention: active always visible; expired and revoked rows visible for 30 days past termination, then filtered.
- Sort: `created_at DESC`.
- Empty state: *"You haven't created any public links yet. Create one to share a read-only snapshot with anyone."*
- **Create dialog** (mock-up State 4): expiry picker 7d / 30d (default) / 90d / custom (1–365 days). Integer days.
  - On submit: row appears at top with "Just created" badge + auto-opened Copy affordance (10s).
- **Revoke dialog** (mock-up State 5): lightweight confirm, no typed phrase. Idempotent.
- **Per-owner cap: 20 active tokens.** 429 `anonymous_token_cap_exceeded` on create beyond. Inline error banner in UI (mock-up State 7).
- **Demo users:** Section C hidden entirely.
- **Admin visibility of shares:** none (follows KZO-144's rejection of `/admin/shares`).
- **URL construction:** API returns full URL in DTO (`url: "..."`); client never reconstructs.

### Q4 — Per-IP rate limit on `/share/:token`

- **Key:** `req.ip`. Not `(ip, token)` — per-pair evades the limit.
- **Limit / window:** 30 requests / 5 minutes, sliding window. Env-tunable:
  `ANONYMOUS_SHARE_RATE_LIMIT_MAX` (default 30), `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (default 300_000).
- **Invalid-token requests are counted.** Critical for enumeration resistance.
- **Order:** rate-limit check BEFORE DB lookup (rejects brute-forcers without burning DB resources).
- **429 response:** `{ error: "rate_limit_exceeded" }` + `Retry-After: 300` header.
- **No 429 audit log entries** (would be a DoS vector against `audit_log`).
- **Memory-only bucket:** `anonymousShareRateBuckets: Map<string, number[]>` in `registerRoutes.ts`.
- **Reset helper:** `_resetAnonymousShareRateBuckets()` exported for tests.
- **Scope limited to `GET /share/:token`** — `/share-tokens/*` (owner CRUD) uses the global mutation limiter.

### Q5 — Token format, storage, schema

- **Token format:** 22-char base62 (alphabet `[a-zA-Z0-9]`), ~131 bits entropy.
- **Generator:** dep-free helper `generateAnonymousShareToken()` using `crypto.randomBytes(32)` +
  rejection-sampling the base62 alphabet. Placement: `apps/api/src/lib/anonymousShareToken.ts`.
- **Storage:** plaintext. Owner UI requires re-display of full URL from list; hashing rules this out.
- **Collision retry:** 3 attempts on `23505` UNIQUE violation, then 500.
- **Never logged in full:** Fastify logger redacts `/share/:token` paths in request logs.
  Audit `metadata` stores `tokenId` (the PK), never the `token`.
- **Migration:** `033_kzo147_anonymous_share_tokens.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS anonymous_share_tokens (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_anonymous_share_tokens_owner_created_at
    ON anonymous_share_tokens(owner_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_anonymous_share_tokens_owner_not_revoked
    ON anonymous_share_tokens(owner_user_id)
    WHERE revoked_at IS NULL;
  -- Cannot use WHERE expires_at > NOW() (non-immutable); app filters at query time.

  DO $$
  BEGIN
    ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (
      action IN (
        'admin_promote_cli','admin_promote_startup','admin_promote_first_signin',
        'admin_role_change','admin_disable_user','admin_enable_user',
        'admin_delete_user','admin_hard_purge_user',
        'admin_invite_issued','admin_invite_revoked',
        'share_granted','share_revoked',
        'share_token_created','share_token_revoked',
        'session_force_logout'
      )
    );
  END $$;
  ```
- **`id` vs `token`:** `id` is stable PK for owner operations (revoke via `DELETE /share-tokens/:id`);
  `token` is the public-URL secret. Revoke API path never carries the secret.
- **`ON DELETE CASCADE` on `owner_user_id`** — KZO-149 cascade extension becomes a memory-side one-liner.
- **Audit entries:**
  | Action | `actor_user_id` | `target_user_id` | `metadata` |
  |---|---|---|---|
  | `share_token_created` | owner | NULL | `{ tokenId, expiresAt, ttlDays }` |
  | `share_token_revoked` | owner | NULL | `{ tokenId }` |
- **`AdminAuditLogClient.tsx` change required** — add `share_token_created` and `share_token_revoked`
  to the "Sharing" filter group's enumeration (the group is explicit, not regex). This is a real code
  change, not an incidental one.

### Q6 — API surface + guards

| Method | Path | Guard(s) |
|---|---|---|
| `POST` | `/share-tokens` | `requireShareGrantorRole` + `requireWriteableContext` (via `WRITE_CONTEXT_GUARD_ROUTE_KEYS`) |
| `GET` | `/share-tokens` | `requireSessionUserId` |
| `DELETE` | `/share-tokens/:id` | `requireShareGrantorRole` + `requireWriteableContext` |
| `GET` | `/share/:token` | none; `PUBLIC_ROUTE_KEYS` |

- **Route-key set additions** in `apps/api/src/routes/registerRoutes.ts`:
  - `PUBLIC_ROUTE_KEYS += "GET /share/:token"`
  - `WRITER_ROLE_ROUTE_KEYS += "POST /share-tokens", "DELETE /share-tokens/:id"`
  - `WRITE_CONTEXT_GUARD_ROUTE_KEYS += "POST /share-tokens", "DELETE /share-tokens/:id"`

- **Unified DTO:**
  ```ts
  type AnonymousShareTokenDto = {
    id: string;
    token: string;           // full token, owner-visible
    url: string;             // fully-qualified, from API
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    status: "active" | "expired" | "revoked";  // derived server-side
  };
  ```

- **`POST /share-tokens` request:** `{ expiresInDays: z.number().int().min(1).max(365) }` → 201 + `AnonymousShareTokenDto`.
- **`GET /share-tokens` response:** `{ tokens: AnonymousShareTokenDto[] }`, sorted `created_at DESC`,
  API applies 30-day retention filter.
- **`DELETE /share-tokens/:id`** — 204 always when the owner matches. Only flips `revoked_at = NOW()`
  when token is **active** (`revoked_at IS NULL AND expires_at > NOW()`); otherwise 204 no-op, no audit.
  Wrong-owner → 404 `token_not_found` (no existence leak).

- **Public `GET /share/:token` handler order:**
  1. `assertAnonymousShareRateLimit(req.ip)` — 429 if over
  2. Token regex pre-check `^[A-Za-z0-9]{22}$` — 404 on mismatch (no DB hit)
  3. `findActiveAnonymousShareTokenByToken(token)` — any failure → 404 `token_not_found`
  4. `getAuthUserById(ownerUserId)` — soft-deleted/deactivated → 404
  5. `loadUserStoreForUserId(app, ownerUserId)` + `resolveQuoteSnapshots()` + build `PublicShareView`
  6. Response headers: `Cache-Control: private, no-store`

- **Error taxonomy:**
  | Code | Status | When |
  |---|---|---|
  | `share_grant_forbidden` | 403 | demo or viewer hits POST/DELETE |
  | `write_blocked_viewing_shared` | 403 | switched-in user hits POST/DELETE |
  | `anonymous_token_cap_exceeded` | 429 | owner at 20-active cap |
  | `validation_error` | 400 | Zod (incl. out-of-range `expiresInDays`) |
  | `token_not_found` | 404 | public route + wrong-owner DELETE |
  | `rate_limit_exceeded` | 429 | per-IP limit |

- **New persistence methods** (both `postgres.ts` and `memory.ts`):
  - `createAnonymousShareToken(input: { ownerUserId, token, expiresAt, auditInput })`
  - `listAnonymousShareTokensForOwner(ownerUserId)` (applies 30d retention)
  - `findActiveAnonymousShareTokenByToken(token)`
  - `revokeAnonymousShareToken(id, ownerUserId, auditInput)`
  - `countActiveAnonymousShareTokensForOwner(ownerUserId)`
- **New helper:** `loadUserStoreForUserId(app, userId)` — extract `loadUserStore`'s body, drop `req`
  dependency. Refactor `loadUserStore(app, req)` to delegate.
- **Race-safety for cap check + insert:** advisory lock via
  `pg_advisory_xact_lock(hashtext('anon_share:' || owner_user_id))` inside the same transaction as
  the count + insert. Memory persistence uses a per-user async mutex (trivial — module-level `Map<userId, Promise>`).

### Q7 — Test coverage (10 HTTP + 5 UI + 1 optional + 1 integration)

**HTTP (`apps/api/test/http/specs/`):**
1. `anon-token-create-happy-aaa.http.spec.ts` — member creates 30d token; DTO shape; `share_token_created` audit with `tokenId`-only metadata; audit discoverable via `GET /admin/audit?action=share_token_created`.
2. `anon-token-create-viewer-403-aaa.http.spec.ts` — `share_grant_forbidden`.
3. `anon-token-create-demo-403-aaa.http.spec.ts` — demo user blocked.
4. `anon-token-create-switched-in-403-aaa.http.spec.ts` — `write_blocked_viewing_shared` with `x-context-user-id` set.
5. `anon-token-create-cap-429-aaa.http.spec.ts` — 21st active token → `anonymous_token_cap_exceeded`.
6. `anon-token-list-retention-aaa.http.spec.ts` — active + within-30d terminal rows returned; ≥30d filtered; `status` correct per row.
7. `anon-token-revoke-lifecycle-aaa.http.spec.ts` — happy 204 + audit; re-revoke 204 no-op no duplicate audit; wrong-owner 404; revoke on expired = no-op (no `revoked_at` flip).
8. `anon-public-view-dto-shape-aaa.http.spec.ts` — happy 200; **no** `costBasisAmount`/txns/dividends in body; zero-qty filtered; sort by market value; per-currency totals + returns; owner display-name fallback chain exercised.
9. `anon-public-view-404-paths-aaa.http.spec.ts` — expired / revoked / non-existent / bad-format / owner-soft-deleted all return identical `{ error: "token_not_found" }` body + status 404.
10. `anon-public-view-rate-limit-aaa.http.spec.ts` — 30 valid OK; 31st 429 + `Retry-After: 300`; invalid tokens also counted; `_resetAnonymousShareRateBuckets()` in `beforeEach`.

**UI E2E (`apps/web/tests/e2e/specs/`):**
11. `anon-token-create-flow-aaa.spec.ts` — `/sharing` → Section C → Create → dialog → 30d → submit → row with Copy button.
12. `anon-token-revoke-flow-aaa.spec.ts` — Revoke dialog → confirm → row moves to Revoked → `/share/{token}` returns 404.
13. `anon-public-view-rendered-aaa.spec.ts` — unauthenticated visit; holdings + summary rendered; no `costBasisAmount` in DOM; `noindex, nofollow` meta present.
14. `anon-public-view-generic-404-aaa.spec.ts` — `/share/invalidToken22Chars000` → generic 404 page.
15. `anon-token-cap-error-aaa.spec.ts` — seed 20 active tokens; click Create → inline amber error banner + disabled button.

**Optional:**
16. `anon-public-view-ignores-auth-aaa.spec.ts` — authed user visits `/share/{token}`; same public content; no `x-session-type` header in response.

**Integration (`apps/api/test/integration/`):**
17. `anonymous-share-tokens.integration.test.ts` — real Postgres:
    - **Cap race:** concurrent `POST /share-tokens` at cap = 19 from two workers; exactly one 201, one 429.
    - **Cascade on user delete:** `DELETE FROM users WHERE id = X` → all rows in `anonymous_share_tokens` for that owner gone.

**Test infrastructure deliverables:**
- `libs/test-api/src/endpoints/AnonymousShareTokensEndpoint.ts`
- `libs/test-api/src/assistants/anonymous-share-tokens/{Arrange,Actions,Assert}.ts` OR placed under existing `shares/` subdirectory for consistency
- **Register in `libs/test-api/src/config/mapper.ts`** (critical — silent runtime failure otherwise per `test-api-mapper-registration.md`)
- `libs/test-e2e/src/pages/sharing/AnonymousSharePage.ts` (public page, unauthenticated)
- Extend `SharingPage` with Section C selectors (e.g. `AnonymousTokensSection` sub-page-object)
- `libs/test-e2e/src/assistants/sharing/AnonymousTokenActions.ts` + `.Assert.ts`
- For public route HTTP specs: evaluate whether the test-api framework supports unauthenticated endpoints, or use raw `fetch` in those specs (hybrid accepted).

**Seed endpoint:**
- `POST /__e2e/seed-anonymous-share-token` — body `{ userId, token?, expiresAt?, revokedAt? }`.
- Uses `assertE2ESeedEnabled()` (not `assertE2EResetEnabled()`) so it works in `AUTH_MODE=oauth` for the API HTTP suite (per `e2e-seed-vs-reset-guards.md`).

### Q8 — Edge cases

- **Empty portfolio:** 200 with `holdings: []`, empty summary arrays, `quoteAsOf: null`. Page renders
  *"This portfolio currently has no active holdings."* (not 404 — the link works, the portfolio is empty).
- **Missing quotes:** omit the affected holding rather than show a zero; recompute totals/returns over
  the quote-available subset. If all holdings lack quotes, treat as empty-portfolio.
- **Soft-deleted/deactivated owner:** public view returns 404 (Q6 step 4).
- **Memory persistence parity:** all 5 new methods implemented in both backends.
- **Rate-limit bucket memory growth:** pre-existing issue shared with `inviteStatusBuckets`; flag for
  future cross-cutting eviction work; no fix here.
- **`loadUserStoreForUserId(app, userId)`:** new helper in `apps/api/src/services/loadUserStore.ts`.
- **Request-log redaction:** Fastify logger `serializers.req` — replace `/share/:token` segment with
  `[REDACTED]` (token may still appear in dev/proxy logs outside the API; document in ops runbook).
- **Clipboard copy:** `navigator.clipboard.writeText` works in prod HTTPS and on localhost (any scheme);
  no fallback needed for dev.
- **i18n:** all new copy in both `en` and `zh-TW` via `apps/web/features/sharing/i18n.ts` + locale sibling files.

### Ultrathink adjustments (beyond Q1–Q8)

- **Revoke-handler tightening (revised from Q6):** only flips `revoked_at` when token is ACTIVE
  (`revoked_at IS NULL AND expires_at > NOW()`). Expired-not-revoked → 204 no-op. Prevents the "revoke
  resets retention clock" quirk and aligns with the UI (Revoke button hidden on terminal rows).
- **`AdminAuditLogClient.tsx` filter-grouping** is explicit code, not regex — actual edit required.
- **Cap-check race-safety** is a scope-level requirement (advisory lock), not implementation trivia.
- **"MUST NOT" code-review gates:**
  - `GET /share/:token` handler must not reference `req.cookies`, `req.headers.cookie`,
    `req.headers['x-user-id']`, `req.headers['x-context-user-id']`.
  - `apps/web/app/share/[token]/page.tsx` must not use `cookies()` from `next/headers` or forward
    auth headers on its API fetch.
- **Architecture doc:** extend `docs/001-architecture/sharing.md` with an "Anonymous share tokens"
  section.
- **Ops runbook:** note plaintext token storage ("DB access = token access") and that re-enabling a
  previously-disabled owner auto-resumes their tokens (see open items).

## Implementation Steps (ordered)

### Schema + migration
- [ ] Create migration `db/migrations/033_kzo147_anonymous_share_tokens.sql` per Q5.
- [ ] Verify `ON DELETE CASCADE` on `owner_user_id` in dev environment.
- [ ] Add `anonymousShareToken.ts` helper at `apps/api/src/lib/anonymousShareToken.ts` — 22-char base62 generator.

### Persistence
- [ ] Extend `Persistence` interface in `apps/api/src/persistence/types.ts` with 5 new methods (Q6).
- [ ] Implement in `apps/api/src/persistence/postgres.ts` — include advisory-lock in `createAnonymousShareToken`.
- [ ] Implement in `apps/api/src/persistence/memory.ts` — include per-user async mutex, parity on retention + active-count filtering.
- [ ] Add `AnonymousShareToken` type + `AnonymousShareTokenDto` + `PublicShareView` type to `libs/shared-types`.

### API routes
- [ ] Add rate-limit bucket + `assertAnonymousShareRateLimit()` + `_resetAnonymousShareRateBuckets()` at `apps/api/src/routes/registerRoutes.ts` (near existing `inviteStatusBuckets`).
- [ ] Register `POST /share-tokens`, `GET /share-tokens`, `DELETE /share-tokens/:id`, `GET /share/:token`.
- [ ] Update `PUBLIC_ROUTE_KEYS`, `WRITER_ROLE_ROUTE_KEYS`, `WRITE_CONTEXT_GUARD_ROUTE_KEYS` sets.
- [ ] Add `Cache-Control: private, no-store` header to public route response.
- [ ] Add Fastify `serializers.req` path redaction for `/share/:token` routes.
- [ ] Add `loadUserStoreForUserId(app, userId)` helper; refactor `loadUserStore(app, req)` to delegate.
- [ ] Add `buildPublicShareView(store, quotes, ownerDisplayName, expiresAt)` service function (new file in `apps/api/src/services/publicShareView.ts`). Derives per-currency return internally without exposing cost basis.

### Env + URL construction
- [ ] Verify `Env.PUBLIC_DOMAIN_WEB` (and scheme resolution) is available; add helper if missing. API
      constructs `url = ${scheme}://${PUBLIC_DOMAIN_WEB}/share/${token}`.
- [ ] Add `ANONYMOUS_SHARE_RATE_LIMIT_MAX` and `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` to env schema.

### Seed endpoint
- [ ] Add `POST /__e2e/seed-anonymous-share-token` guarded by `assertE2ESeedEnabled()`.

### Web app
- [ ] `apps/web/app/share/[token]/page.tsx` — SSR server component per Q2.
- [ ] `apps/web/app/share/[token]/not-found.tsx` (if Next.js pattern requires) OR handle in `page.tsx` via `notFound()`.
- [ ] `apps/web/components/sharing/PublicLinksSection.tsx` — Section C with list + Create button.
- [ ] `apps/web/components/sharing/CreateAnonymousLinkDialog.tsx` — matches mock-up State 4.
- [ ] `apps/web/components/sharing/RevokeAnonymousLinkDialog.tsx` — matches State 5.
- [ ] `apps/web/components/sharing/AnonymousLinksTable.tsx` — truncated token + Copy + status pill + Revoke.
- [ ] Mount Section C in `SharingClient.tsx` below existing Outbound/Inbound.
- [ ] `apps/web/features/sharing/i18n.ts` + zh-TW sibling — new entries for Section C, dialogs, status pills, empty state, cap-exceeded banner.
- [ ] `apps/web/lib/api.ts` — add typed fetchers `listAnonymousTokens()`, `createAnonymousToken(days)`, `revokeAnonymousToken(id)`.
- [ ] Hide Section C when `isDemo === true`.
- [ ] Verify `UserAvatarButton` "Sharing" link (already hidden for demo) still behaves correctly.

### Admin audit extension (KZO-144 follow-up)
- [ ] Add `share_token_created` + `share_token_revoked` to the "Sharing" filter group in `AdminAuditLogClient.tsx`. Update group label copy if needed.

### Documentation
- [ ] Extend `docs/001-architecture/sharing.md` with an "Anonymous share tokens" section.
- [ ] Append to ops runbook: plaintext token storage, rate-limit bucket memory growth, re-enable-owner auto-resume behavior.

### Test infrastructure + AAA specs (17 total per Q7)
- [ ] `libs/test-api/src/endpoints/AnonymousShareTokensEndpoint.ts`
- [ ] `libs/test-api/src/assistants/...` (Arrange, Actions, Assert)
- [ ] **Register in `libs/test-api/src/config/mapper.ts`**
- [ ] `libs/test-e2e/src/pages/sharing/AnonymousSharePage.ts`
- [ ] `libs/test-e2e` — extend SharingPage + assistants
- [ ] 10 HTTP specs (list in Q7)
- [ ] 5 UI E2E specs (list in Q7)
- [ ] 1 optional E2E spec (auth-ignored)
- [ ] 1 integration test (cap race + CASCADE)
- [ ] `anon-public-view-rate-limit-aaa.http.spec.ts` resets bucket in `beforeEach`.

### Pre-PR validation
- [ ] Full 7-suite run (per `full-test-suite.md`): eslint, typecheck, web unit, API integration, E2E bypass+mem, E2E oauth+mem, API HTTP.
- [ ] `/code-reviewer` pre-PR pass per `code-review-before-pr.md`.
- [ ] Verify AAA spec scope in typecheck (per CR gotcha in `code-review-before-pr.md` — spec tsconfig includes new files).
- [ ] Code-review "MUST NOT" gates for `req.cookies` / `cookies()` usage in both handler and page.

## Open Items (carry forward as notes)

- [ ] **Disable-owner re-enable auto-resumes tokens** — intentional for MVP. If future security posture
      requires "disable also revokes tokens," add a hook to `disableUser` in KZO-144's admin service.
      Not a code change here; document in runbook.
- [ ] **Long-tail revoked-token cleanup** — DB rows for `revoked_at < NOW() - 90d` accumulate.
      Future cron candidate; no pressure today.
- [ ] **Rate-limit bucket memory growth** — cross-cutting issue shared with `inviteStatusBuckets`
      (KZO-143). Fix in a dedicated "rate-limit bucket eviction" follow-up ticket.
- [ ] **Token view counter** — explicitly not added. DB write per GET + contention. Re-evaluate if
      product asks "how many times has someone viewed my link?"
- [ ] **Day-change % / sparkline on public view** — not in MVP scope. Trivial once `resolveQuoteSnapshots`
      returns previous-close; add in a v2 if requested.
- [ ] **Preview-as-viewer affordance for owners** — not added. Owner can copy-paste URL to incognito
      for the same effect.
- [ ] **KZO-148 (admin impersonation)** — future: verify `isImpersonating` flag blocks `POST /share-tokens`.
      Add this as a deliverable on KZO-148's scope when it opens.

## References

- Parent epic: [KZO-141](https://linear.app/kzokv/issue/KZO-141) (done scope at `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`)
- Siblings (done): [KZO-143](https://linear.app/kzokv/issue/KZO-143), [KZO-144](https://linear.app/kzokv/issue/KZO-144), [KZO-145](https://linear.app/kzokv/issue/KZO-145), [KZO-146](https://linear.app/kzokv/issue/KZO-146)
- Follow-up: [KZO-149](https://linear.app/kzokv/issue/KZO-149) (hard-purge cascade — blocked by this + KZO-146)
- Mock-up: `docs/004-notes/kzo-147/mockup-anonymous-share.{html,png}` — 7 states (public happy/empty/404, owner section, create dialog, revoke dialog, cap-exceeded)
- No debate note (scope resolved entirely in Phase 1 — 8 questions + ultrathink pass)

## Permissions summary (reference)

| Action | admin | member | viewer | demo |
|---|:-:|:-:|:-:|:-:|
| Create anonymous share token on own portfolio | ✅ | ✅ | ❌ | ❌ |
| List / revoke own tokens | ✅ | ✅ | ❌ | ❌ |
| Create / revoke while viewing shared (via switcher) | ❌ | ❌ | ❌ | ❌ |
| View `/share/{token}` | any unauthenticated or authenticated | — | — | — |
| See `/admin/audit` entries `share_token_*` | ✅ | ❌ | ❌ | ❌ |
