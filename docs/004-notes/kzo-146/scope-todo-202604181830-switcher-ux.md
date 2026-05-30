---
slug: kzo-146
source: scope-grill
created: 2026-04-18
tickets: [KZO-146]
required_reading:
  - docs/004-notes/kzo-145/scope-todo-202604171530-share-grant-ui.md
  - docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md
  - docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md
  - docs/004-notes/kzo-146/mockup-switcher-ux.html
  - docs/004-notes/kzo-146/mockup-switcher-ux.png
  - docs/001-architecture/sharing.md
superseded_by: null
---

# Todo: KZO-146 — Portfolio switcher UX (scope-grill resolution)

> **For agents starting a fresh session:** read all files in `required_reading` before implementing. KZO-145 is **merged and on `dev`** — it delivered `portfolio_shares`, the `/shares` API, the `/sharing` page, grant/revoke UI, OAuth-callback share materialization, audit entries, notifications, and 18 AAA specs. KZO-146 delivers the **context-switcher** part of KZO-141c that KZO-145 deliberately deferred. Half the server-side infrastructure already exists (`RequestAuthContext.contextUserId`, `loadUserStore(contextUserId)`, `resolveUserId` returning `userId` aliased to `contextUserId`); today `contextUserId` is unconditionally set equal to `sessionUserId`. KZO-146 flips that switch and builds the UX around it.

Parent epic: KZO-141. Predecessor: KZO-145 (share grant UI — merged). Blocks: KZO-148 (admin impersonation), KZO-149 (hard-purge cascade extension).

## Visual references

- `docs/004-notes/kzo-146/mockup-switcher-ux.html` — rendered layout of TopBar switcher across six states (Tailwind CDN, open in a browser)
- `docs/004-notes/kzo-146/mockup-switcher-ux.png` — static screenshot of the same

## Locked Decisions

### Q1 — Context transport

**Cookie + header, mirroring the `tw_e2e_user_role` → `x-user-role` plumbing KZO-145 shipped in `apps/web/lib/api.ts`.**

- `tw_context_user_id` cookie (`HttpOnly=false`, `SameSite=Lax`, path=`/`) is the persistence mechanism.
- Client fetch wrapper in `apps/web/lib/api.ts` reads the cookie and injects `x-context-user-id` header on every API request.
- `apps/web/proxy.ts` forwards the cookie → header when proxying to Fastify (needed for SSR/server components).
- Server-side `hydrateAuthContext` reads the header, validates against `portfolio_shares` (active, non-revoked, grantee = sessionUserId, owner = header value), sets `contextUserId = owner` on success.
- Invalid / revoked / spoofed → fallback: `contextUserId = sessionUserId`, response header `x-context-fallback: revoked`, plus `Set-Cookie: tw_context_user_id=; Max-Age=0` so SSR path also clears the cookie.

Rejected alternatives:
- URL query param as transport — requires every Fastify schema to accept it; SSR awkward.
- Server-minted signed cookie via `POST /session/context` — adds a new endpoint + CSRF surface + crypto, buys zero real security because the DB re-validation per-request is what enforces the boundary anyway.

### Q2 — Endpoint taxonomy (narrow)

**Only portfolio-store reads flip to `contextUserId`. Identity / cross-user reads use `sessionUserId` explicitly.**

| Category | Endpoints | User ID used |
|---|---|---|
| Portfolio reads (flip) | anything going through `loadUserStore`: `/dashboard`, `/holdings`, `/positions`, `/transactions`, `/dividends`, `/cash-ledger`, `/tickers/*`, `/portfolio` | `contextUserId` |
| Portfolio writes (guarded) | POST/PATCH/DELETE on any portfolio-store-backed path | `sessionUserId`, with guard: 403 `write_blocked_viewing_shared` when `sessionUserId !== contextUserId` |
| Identity / cross-user | `/profile`, `/notifications/*`, `/shares`, `/sse`, `/admin/*` | `sessionUserId` explicitly |

Rejected alternative: "wide" taxonomy that flips everything. Still requires admin carve-outs and notification carve-outs, so it isn't simpler; produces UX bugs (bell shows Alice's unreads while switched in) and cross-user data leaks (`/shares` would show Alice's outbound grants).

**Implementation consequence:** every `resolveUserId(...).userId` call site currently returns `contextUserId` (the alias at `registerRoutes.ts:459`). Endpoints in the bottom two rows must switch to explicit `sessionUserId`. Introduce a helper — `requireSessionUserId(req)` or equivalent — to make the intent greppable. ~15 call sites to update; the grep `sessionUserId` (41 refs) vs `contextUserId` (20 refs) already suggests the rough split.

### Q3 — Switcher placement

**TopBar dropdown, always visible when `inbound.active.length >= 1`. Auto-hidden otherwise.**

- Lives in `apps/web/components/layout/TopBar.tsx`, between the page title and the search input (desktop) / collapsing to an icon on mobile.
- Options list:
  - **Pinned top:** "My Portfolio" with session user's avatar/initials.
  - **Shared with you:** shared portfolios sorted by grant date desc. Label: `{ownerDisplayName || ownerEmail}'s Portfolio`. Subtext: `{ownerEmail} · shared {relativeDate}`. Badge: "Read".
  - **Footer:** "Manage sharing" link to `/sharing`.
- Selected pill appearance:
  - "My Portfolio" selected → neutral slate pill.
  - Shared owner selected → rose-tinted pill with "Read-only" badge, + TopBar eyebrow text "Viewing shared portfolio".
- Visual indicator doubles as write-state signal; no separate banner component needed.
- Present on all authenticated pages (including `/admin`, `/sharing`, `/profile`) — harmless on those pages per narrow taxonomy.

**`InboundSharesCards` "Open in switcher" button (KZO-145 `InboundSharesCards.tsx:60-65`):** change from `href="/dashboard"` to an `onClick` that writes the cookie + navigates in one step (`router.push("/dashboard")`).

Rejected alternatives:
- Dashboard-only (KZO-145 i18n copy implies this) — forces extra navigation, no upside given narrow taxonomy.
- Route-conditional visibility — adds complexity and inconsistency for no benefit.

### Q4 — Revoked-context fallback

**SSE-proactive with lazy 403 safety net.**

- **Primary (instant):** notification SSE handler (extend existing `useNotifications` / equivalent) filters `source="sharing"` revoke events. If `detail.ownerUserId === currentSwitcherSelection` → clear cookie, reset switcher to "My Portfolio", show toast ("Access to {owner}'s portfolio was revoked"), invalidate all portfolio queries.
- **Safety net (lazy):** client fetch wrapper in `apps/web/lib/api.ts` checks every response for `x-context-fallback: revoked`. On match → same teardown sequence as SSE handler. Covers SSE-disconnected / tab-suspended / ad-blocker scenarios.
- Server still re-validates `portfolio_shares` on every request; the mechanism above is pure UX polish on top of the always-correct server-side check.

Rejected alternatives:
- Lazy-only (scope-as-written): leaves a visible-staleness window while grantee views revoked owner's data until next fetch.
- SSE-only: fragile to disconnected streams.

### Q5 — `isSharedContext` flag

**Introduce `isSharedContext: boolean` on `RequestAuthContext`. Reserve `isImpersonating` for KZO-148 admin impersonation.**

- `apps/api/src/types/fastify.d.ts`: add `isSharedContext: boolean` alongside the existing `isImpersonating`.
- Auth middleware sets `isSharedContext = true` iff the context-header validation succeeded and `sessionUserId !== contextUserId`.
- KZO-148 will set `isImpersonating = true` for admin-support-debug sessions (read-only, banner, time-limited, write-capable with extra logging — explicitly different semantics from sharing).

Rejected alternatives:
- Both features use `isImpersonating` — conflates two products with divergent semantics (read-only vs. write-capable-with-audit).
- Single `impersonationMode` enum — cleaner for symmetry but forces pattern-matching at every call site; two booleans are simpler and typescript-exhaustiveness-friendly.

### Q6 — URL `?as=X` semantics

**Cookie is source of truth. `?as=X` is a one-shot deep-link override.**

- On page load, if URL has `?as=X`:
  1. Validate (client-side can pre-check against inbound list to skip a round-trip; server re-validates on next request regardless)
  2. Write cookie
  3. Strip the `?as=` param via `history.replaceState` so it doesn't persist in the URL
- Switcher interactions (dropdown select) update the cookie only. URL never gets a context query string from normal navigation.
- localStorage has no role in context propagation (scope-todo line 108 mentioned it but Q1 supersedes that).

Rejected alternatives:
- URL + cookie sync — two sources of truth, race conditions, URL pollution with sensitive identifiers (referer header leakage).

---

## Implementation plan

### Database / migrations
- [x] **No new migration required.** `portfolio_shares` table + `invites.share_owner_user_id` column already exist from KZO-145 migration `032_kzo146_sharing.sql`.

### Persistence layer
- [x] `validateActiveShare(ownerUserId, granteeUserId)` — lookup helper used by the auth middleware; returns `boolean` (or the share row for richer diagnostics). Uses the existing partial unique index `(owner, grantee) WHERE revoked_at IS NULL` for lookup efficiency. _Delivered: `memory.ts:620`, `postgres.ts:1166` (single-indexed EXISTS lookup), interface documented in `types.ts:439-444`._
- [x] Reuse existing `listInboundSharesForGrantee` (KZO-145) for the switcher's dropdown options; no new endpoint needed. _Delivered: `AppShell.refreshSwitcherData` → `fetchSharingPageData` → `GET /shares` → `listInboundSharesForGrantee`._

### API / auth middleware
- [x] `apps/api/src/types/fastify.d.ts` — add `isSharedContext: boolean` to `RequestAuthContext`. _Delivered: `fastify.d.ts:15`._
- [x] `resolveCookieBackedAuthContext` — read `x-context-user-id` header; if present, call `validateActiveShare(header, authUser.userId)`; on success set `contextUserId = header`, `isSharedContext = true`; on miss fall back to `contextUserId = sessionUserId`, `isSharedContext = false`, stamp response header `x-context-fallback: revoked` + `Set-Cookie` clear. _Delivered: `resolveContextOverride` at `registerRoutes.ts:482-511` + onSend hook at `app.ts:206-218` + streaming-route propagation in `sseRoute.ts:pickContextFallbackHeaders`._
- [x] `resolveDevBypassFallback` — same treatment; tests must exercise the validation path. _Delivered: dev_bypass path in `hydrateAuthContext` (line 617) calls `resolveContextOverride`, so `validateActiveShare` runs in dev_bypass mode. Covered by UI E2E specs (dev_bypass) and HTTP specs (oauth)._
- [x] Write-path guard — central middleware on portfolio-write endpoints: `if (sessionUserId !== contextUserId) throw routeError(403, "write_blocked_viewing_shared", ...)`. Applied to 22 routes. _Delivered: `WRITE_CONTEXT_GUARD_ROUTE_KEYS` + `requireWriteableContext` + `enforceRouteRole` at `registerRoutes.ts:312-334, 649-673`. Excludes `/profile`, notification CUD per narrow-taxonomy._
- [x] Identity/cross-user endpoints — introduce a `requireSessionUserId(req)` helper and replace `resolveUserId(req).userId` with it at the ~15 call sites for `/profile`, `/notifications/*`, `/shares`, `/sse`, `/admin/*`. _Delivered: `requireSessionUserId` at `registerRoutes.ts:554`, 28 call sites migrated (identity/cross-user); `resolveUserId` scoped to portfolio-read via `loadUserStore`._

### Web — TopBar + switcher
- [x] `apps/web/components/layout/TopBar.tsx` — add `PortfolioSwitcher` child component between title and search. _Delivered: `portfolioSwitcher` prop + desktop/mobile slots at `TopBar.tsx:260-271`._
- [x] `apps/web/components/layout/PortfolioSwitcher.tsx` (new) — dropdown component; reads inbound shares; hidden when `inbound.active.length === 0`; dispatches cookie write + query invalidation on selection. _Delivered: 162-line component with Radix DropdownMenu, rose-pill read-only styling, eyebrow + badge, sort by createdAt desc, Manage-sharing footer link. Unit tests in `test/components/layout/PortfolioSwitcher.test.tsx`._
- [x] `apps/web/lib/context.ts` (new) — helpers `readContextCookie()`, `writeContextCookie(ownerUserId | null)`, `clearContextCookie()`, `applyDeepLinkAs(searchParams)`. _Delivered: `lib/context.ts` (all four exports + `CONTEXT_CHANGED_EVENT` + `CONTEXT_FALLBACK_REVOKED_EVENT` constants). Unit tests in `test/lib/context.test.ts`._
- [x] `apps/web/lib/api.ts` — extend fetch wrapper to (a) inject `x-context-user-id` from cookie and (b) intercept responses for `x-context-fallback: revoked` → clear cookie + emit teardown event. _Delivered: `getAuthHeaders` + `getContextUserId` + `handleContextFallback` in `lib/api.ts`. Unit tests in `test/lib/api.test.ts`._
- [x] `apps/web/proxy.ts` — forward `tw_context_user_id` cookie → `x-context-user-id` header when proxying API calls (SSR path). _Delivered: `proxy.ts` + extracted-for-test `lib/proxyHeaders.applyContextForwarding` (with anti-spoof delete on missing cookie). Unit tests in `test/proxy.test.ts`._
- [x] `apps/web/components/sharing/InboundSharesCards.tsx` — replace `href="/dashboard"` with `onClick` that writes cookie + `router.push("/dashboard")`. _Delivered: `handleOpenDashboard` at `InboundSharesCards.tsx:23-26`._
- [x] `apps/web/features/sharing/i18n.ts` — update "from the dashboard" copy to "from the top bar". _Delivered: `switcherHint` (line 27 / 114) updated for en + zh-TW; `openSwitcher` copy added (line 78)._
- [x] `apps/web/hooks/useNotifications.ts` — add filter for `source="sharing"` revoke events; call shared teardown helper when `detail.ownerUserId === currentSelection`. _Delivered: `onSharingNotification` callback in `useNotifications` + `handleSharingNotification` in `AppShell.tsx:351-377` (title match on "Portfolio access revoked", owner check, `clearContextCookie()` + toast + refresh)._
- [x] `apps/web/hooks/useNotifications.ts` — also handle `source="sharing"` grant events → invalidate inbound-shares query so switcher appears mid-session. _Delivered: `handleSharingNotification` unconditionally calls `refreshSwitcherData()` so grants refresh the inbound list alongside revokes._
- [x] Query invalidation on switcher change — refresh all portfolio-store-backed queries on cookie write. _Delivered: `handleContextSelect` → `refreshContextDependentData` → `router.refresh()` + dashboard/performance/profile/recentTransactions/switcher refetches in parallel._
- [x] Logout flow — clear `tw_context_user_id` cookie alongside existing session teardown. _Delivered: client-side `onClick={() => clearContextCookie()}` on `UserAvatarButton.tsx:162`; server-side `Set-Cookie: tw_context_user_id=; Max-Age=0` alongside session-cookie clear in `/auth/logout` route (added in code-review H1 fix); `redirectToLogoutOn401` in `lib/api.ts` also clears. Covered by `switcher-logout-clears-cookie-aaa.spec.ts` (UI path + direct-GET path)._

### Web — switched-in UX
- [x] Hide write CTAs when `isSharedContext === true`. _Delivered: `ActionCenterSection.readOnly` (dashboard recompute + generate-snapshots hidden behind rose read-only message), `AddTransactionCard` replaced by read-only Card on transactions page, `Record transaction` button hidden on ticker detail page + new `ticker-history-readonly` banner (added in code-review M1 fix)._
- [x] TopBar eyebrow text — "Viewing shared portfolio" (rose accent) when switched in. _Delivered: `portfolio-switcher-eyebrow` at `PortfolioSwitcher.tsx:56-63`, rose-600 uppercase tracking._
- [x] Context-aware empty-state copy on `/dashboard`, `/portfolio`, `/transactions` — when switched-in, empty states use owner-facing copy. _Delivered: `uiDict` shadow in `AppShell.tsx:130-154` conditionally replaces `dashboardHome.holdingsEmpty` with `switcher.sharedHoldingsEmpty` (owner-interpolated) and `transactions.recentLedgerEmpty` with `switcher.sharedTransactionsEmpty` — guarded on `holdings.length === 0` / `recentTransactions.items.length === 0` so filter-empty states don't get miscaptioned (M4 fix)._

### Documentation
- [x] `docs/001-architecture/sharing.md` — add a new "Switcher" subsection covering: transport (cookie → header), narrow taxonomy, `isSharedContext` flag, fallback mechanism (SSE-proactive + lazy), URL semantics (one-shot `?as=`), concurrent-tab limitations (v1 last-tab-wins), logout cleanup. _Delivered: "TopBar switcher" subsection at `sharing.md:147-163`._
- [x] `docs/001-architecture/auth-and-session.md` — reference the new `isSharedContext` flag, update the `resolveUserId` description to explain context vs. session distinction for sharing (distinct from future admin impersonation). _Delivered: "Shared portfolio context transport" subsection at `auth-and-session.md:200-215`._

---

## AAA test coverage

Each scenario below becomes an AAA triplet. HTTP-layer tests live in `apps/api/test/http/specs/` (AUTH_MODE=oauth); UI E2E live in `apps/web/tests/e2e/specs/` (dev_bypass). Follow the `tw_context_user_id` cookie → `x-context-user-id` header pattern established by KZO-145's `tw_e2e_user_role` forwarding.

### HTTP-layer AAA (6 required)

1. [x] **switcher-context-header-owner-read-aaa.http.spec.ts**
   - Arrange: owner + grantee + active share; owner has 2 transactions; grantee authenticated
   - Actions: grantee calls `GET /dashboard` with `x-context-user-id: owner.userId`
   - Assert: 200; response reflects owner's data (2 transactions, owner's holdings); no `x-context-fallback` header

2. [x] **switcher-context-invalid-fallback-aaa.http.spec.ts**
   - Arrange: grantee authenticated; NO active share to some random user
   - Actions: grantee calls `GET /dashboard` with `x-context-user-id: random-uid`
   - Assert: 200 with grantee's own data (fallback); response header `x-context-fallback: revoked`; `Set-Cookie: tw_context_user_id=; Max-Age=0`

3. [x] **switcher-context-revoked-fallback-aaa.http.spec.ts**
   - Arrange: owner + grantee + active share → owner revokes share
   - Actions: grantee calls `GET /dashboard` with `x-context-user-id: owner.userId`
   - Assert: 200 with grantee's own data; `x-context-fallback: revoked`

4. [x] **switcher-write-blocked-aaa.http.spec.ts**
   - Arrange: owner + grantee + active share; grantee authenticated
   - Actions: grantee calls `POST /transactions {...}` with `x-context-user-id: owner.userId`
   - Assert: 403 `write_blocked_viewing_shared`; no transaction row written for either user

5. [x] **switcher-narrow-taxonomy-aaa.http.spec.ts**
   - Arrange: owner + grantee + active share; grantee has 3 own notifications; owner has 2 own notifications; grantee has their own inbound/outbound shares distinct from owner's
   - Actions: grantee calls `GET /notifications`, `GET /profile`, `GET /shares` — all with `x-context-user-id: owner.userId`
   - Assert: returns **grantee's** own notifications (3), profile, and shares (NOT owner's 2 notifications / owner's profile / owner's shares)

6. [x] **switcher-sse-revoke-event-aaa.http.spec.ts** (integration — Postgres-backed)
   - Arrange: owner + grantee + active share; grantee has SSE connection open
   - Actions: owner revokes share via `DELETE /shares/:id`
   - Assert: grantee's event stream receives notification with `source="sharing"`, title "Portfolio access revoked", `detail.ownerUserId === owner.userId`, `detail.shareId === share.id`

### UI E2E AAA (6 required)

7. [x] **switcher-visibility-aaa.spec.ts** (dev_bypass)
   - Arrange: two sub-scenarios: (a) user with 0 inbound shares; (b) user with 1+ active inbound shares
   - Actions: navigate to `/dashboard` in each
   - Assert: (a) `portfolio-switcher` element absent; (b) present with "My Portfolio" + owner option visible

8. [x] **switcher-select-flips-data-aaa.spec.ts** (dev_bypass)
   - Arrange: grantee with 1 active inbound share; owner has distinct portfolio data (seeded)
   - Actions: navigate to `/dashboard`, open TopBar switcher, click owner option
   - Assert: dashboard data updates to owner's; `tw_context_user_id` cookie set to owner.userId; write CTAs hidden

9. [x] **switcher-sse-revoke-fallback-aaa.spec.ts** (dev_bypass)
   - Arrange: grantee switched into owner's portfolio; SSE connected
   - Actions: test harness triggers owner revoke via API call
   - Assert: within N seconds, switcher resets to "My Portfolio"; revoke toast visible; page data refetched to grantee's own; `tw_context_user_id` cookie cleared

10. [x] **switcher-deep-link-strip-aaa.spec.ts** (dev_bypass)
    - Arrange: grantee with active inbound share from owner; no cookie set
    - Actions: navigate to `/dashboard?as={owner.userId}`
    - Assert: cookie written; URL no longer contains `?as=` (stripped via `history.replaceState`); switcher shows owner selected; page data is owner's

11. [x] **switcher-card-button-one-click-aaa.spec.ts** (dev_bypass)
    - Arrange: grantee on `/sharing` with 1 active inbound card
    - Actions: click "Open in switcher" on inbound card
    - Assert: URL becomes `/dashboard`; cookie set; TopBar switcher shows owner selected; dashboard displays owner's data

12. [x] **switcher-cross-page-persistence-aaa.spec.ts** (dev_bypass)
    - Arrange: grantee switched in on `/dashboard`
    - Actions: navigate `/dashboard` → `/portfolio` → `/transactions`
    - Assert: switcher selection persists across pages; cookie unchanged; page data is owner's on each route

### Optional UI E2E AAA (2 stretch)

13. [x] **switcher-logout-clears-cookie-aaa.spec.ts** (dev_bypass) — switched-in grantee logs out → `tw_context_user_id` cleared alongside session cookie.
14. [x] **switcher-admin-route-unaffected-aaa.spec.ts** (dev_bypass, admin role with active inbound share) — admin switched-in navigates to `/admin/users` → sees admin's own data (sessionUser), not owner's; confirms narrow taxonomy at UI layer.

### Test-api / E2E infrastructure
- [x] `apps/web/lib/api.ts` — extend cookie-forwarding to include `tw_context_user_id` → `x-context-user-id` (production code path; E2E uses the same pattern, no separate `tw_e2e_` prefix needed).
- [x] Add a `ContextSwitcher` assistant in `libs/test-e2e/src/assistants/sharing/` that exposes `switchTo(ownerUserId)` / `switchToSelf()` helpers reading/writing the cookie via Playwright's `context.addCookies` — reusable across the scenarios above.

---

## Open items (carried forward as notes)

1. **Cross-tab cookie sync (v2 polish)** — Tab A switches to Alice → Tab B's in-memory switcher selector is stale (cookie was updated but component didn't re-read). v1 accepts last-tab-wins. Future: `window.addEventListener("storage", ...)` or `BroadcastChannel` to sync selected value across tabs.

2. **Notification i18n for sharing** — Inherited from KZO-145 open items. Server emits English-only notification titles/bodies via `shareHelpers.ts`. zh-TW locale users see English. Deferred to a repo-wide notification-localization pass (tracking: KZO-145 open items #1).

3. **KZO-148 admin impersonation interaction** — Admin impersonating Alice → `sessionUserId = admin`, `contextUserId = Alice`, `isImpersonating = true`, `isSharedContext = false`. Under narrow taxonomy, `/shares` returns admin's own shares (not Alice's); this may need a dedicated carve-out when KZO-148 lands. Documented here as an invariant, not a fix: separate `impersonationMode` or combination of both flags is KZO-148's problem.

4. **Context-aware empty-state copy** — When switched-in, dashboard/portfolio/transactions empty states need owner-facing copy instead of self-facing. Small per-page copy task. Folded into this ticket's web-UX checklist above; if it grows (more pages affected, i18n rework), consider splitting.

---

## Out of Scope (explicitly rejected or deferred)

- URL query param as transport (Q1 — rejected in favor of cookie + header)
- Server-minted signed context cookie via `POST /session/context` (Q1 — rejected, zero security gain, added surface)
- Wide endpoint taxonomy (Q2 — rejected, produces UX bugs and cross-user leaks)
- Dashboard-only switcher placement (Q3 — rejected, unnecessary navigation friction)
- URL + cookie sync (Q6 — rejected, two sources of truth)
- Cross-tab storage/BroadcastChannel sync (deferred to v2)
- Admin-impersonation integration details (KZO-148 owns)
- Pagination of switcher options (unlikely to hit scale; revisit if needed)
- Keyboard shortcut for switcher toggle (polish; can be follow-up)
- New audit actions — sharing audit emission (`share_granted`, `share_revoked`) already shipped in KZO-145
- New migration — schema work already done in `032_kzo146_sharing.sql`

---

## Permissions Matrix (switcher surfaces)

| Action | admin | member | viewer | demo |
|---|:-:|:-:|:-:|:-:|
| See TopBar switcher (when ≥1 inbound share) | Yes | Yes | Yes | Yes (if any inbound) |
| Select "My Portfolio" | Yes | Yes | Yes | Yes |
| Select shared owner from switcher | Yes | Yes | Yes | Yes (if they have shares) |
| Write portfolio data while switched-in | 403 | 403 | 403 | 403 |
| Read portfolio data while switched-in | Yes (owner's) | Yes | Yes | Yes |
| Use `/admin/*` routes while switched-in | Yes (uses sessionUserId) | n/a | n/a | n/a |
| Notifications/profile affected by switcher | No (sessionUserId) | No | No | No |
| Receive SSE revoke event when switched-in | Yes | Yes | Yes | Yes |

## References

- Predecessor scope-todo (grant UI, shipped): `docs/004-notes/kzo-145/scope-todo-202604171530-share-grant-ui.md`
- Parent epic scope-todo: `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`
- Foundations scope-todo: `docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md`
- Architecture: `docs/001-architecture/sharing.md`, `docs/001-architecture/auth-and-session.md`, `docs/001-architecture/backend-db-api.md`
- Linear: KZO-146 (this ticket), KZO-145 (predecessor, merged), KZO-148 (blocked by this, admin impersonation), KZO-149 (blocked by this, hard-purge cascade extension)
- Mockup HTML: `docs/004-notes/kzo-146/mockup-switcher-ux.html`
- Mockup PNG: `docs/004-notes/kzo-146/mockup-switcher-ux.png`
- Related rules: `test-api-mapper-registration.md`, `test-placement-persistence-backend.md`, `playwright-oauth-cookie-patterns.md`, `nextjs-i18n-serialization.md`, `react-useEventStream-preconnect-pattern.md`, `service-error-pattern.md`, `interface-caller-verification.md`
