# Demo Session Cleanup Strategy — Debate Meeting Note

**Date:** 2026-03-22
**Tickets:** KZO-107, KZO-108
**Participants:** Architect, Backend, Frontend, QA
**Facilitator:** Team Lead

---

## Decision

**Option 1 Enhanced: Cookie Max-Age + background cleanup + `is_demo` column with response header enrichment.**

Consensus reached after 2 rounds. Option 1 core with surgical additions to address Frontend/QA concerns — no server-side session table, no per-request middleware.

---

## Options Evaluated

| # | Option | Advocates | Verdict |
|---|--------|-----------|---------|
| 1 | Cookie Max-Age + background cleanup job | Architect, Backend | **Selected (enhanced)** |
| 2 | Server-side `demo_sessions` table | Frontend, QA | Rejected — disproportionate |
| 3 | Ephemeral in-memory persistence | (none) | Rejected unanimously |

---

## Round 1: Opening Positions

### Architect — Option 1

**Core thesis:** Architectural coherence with the stateless HMAC cookie model. Demo users are regular users with a flag, not a special case in the request pipeline.

**Strongest points:**
1. `resolveUserId()` (registerRoutes.ts:182) is a pure function — zero I/O. Option 2 would inject a DB round-trip into the auth hot path for a demo feature.
2. Schema change is trivially small: `ALTER TABLE users ADD COLUMN is_demo BOOLEAN DEFAULT false` + `demo_expires_at TIMESTAMPTZ`. One migration, follows existing pattern (`deactivated_at`, `deleted_at` from migration 014).
3. No new infrastructure categories. Cleanup can be a `setInterval` in the API process (~5 lines). Not Kubernetes CronJobs, not a message queue.
4. FK cleanup is tractable: `saveAccountingStoreTx` (postgres.ts:1628-1642) already demonstrates the correct delete ordering for all user-scoped tables.
5. Proportionality: demo is not core product. Complexity budget should be near zero.

**Against Option 2:**
- "Precise expiry" solves a non-problem. No privacy obligation for demo users — they entered no PII.
- Per-request DB check is "architecturally poisonous" — bifurcates `resolveUserId` for all code that touches auth.
- Creates a hybrid auth model (real=stateless, demo=stateful) that leaks into every auth-touching component.

**Against Option 3:**
- Most architecturally destructive. Requires per-request persistence routing — `buildApp()` creates exactly one `Persistence` instance today.
- `MemoryPersistence` has known production-quality gaps (O(n) lookup, no email uniqueness, null timestamps).
- Horizontal scaling requires sticky sessions. Data lost on deploy.

### Backend — Option 1

**Core thesis:** Zero changes to the request pipeline. The demo endpoint is a new route that calls existing `resolveOrCreateUser` + `ensureDefaultPortfolioData`. Every other request from a demo user flows through identical code paths as a real user.

**Strongest points:**
1. FK deletion order already exists in production (`saveAccountingStoreTx`). The cleanup function extracts this pattern.
2. Cookie `Max-Age` is enforced client-side — correct UX boundary. Backend cleanup is not time-critical.
3. Implementation is ~120 lines new, ~10 modified. No existing code paths altered.
4. Partial index `WHERE is_demo = true` keeps cleanup queries fast without affecting normal user queries.

**Implementation sketch:**
- Migration: 2 columns + partial index
- New Persistence method: `markDemoUser(userId, ttlSeconds)`
- New route: `POST /auth/demo/start`
- Cleanup: `setInterval` calling `cleanupExpiredDemoUsers(pool)` every 15 min
- File changes: 8 files (1 new migration, 1 new service, 6 modifications)

### Frontend — Option 2

**Core thesis:** Only server-side session state can distinguish "demo expired" from "unauthenticated" at the 401 boundary.

**Strongest points:**
1. `redirectToLogoutOn401` in `api.ts` (lines 81-86) fires a blind redirect on any 401. When demo cookie expires, browser stops sending it, server sees no cookie, returns generic 401. User is ripped from dashboard with zero explanation. Option 2 enables `410 Gone` with `X-Demo-Session-Expired: true`.
2. `NEXT_PUBLIC_DEMO_MODE_ENABLED` tells the login page to show the button, but doesn't tell the dashboard "this specific user is a demo user." Real Google users and demo users can coexist.
3. Countdown timer requires server-provided `expiresAt`. Cookie `Max-Age` has clock skew problems — browser throttles timers in background tabs (Chrome: 1 call/minute for background `setInterval`).
4. "Upgrade to real account" flow needs server-side demo session mapping — cookie may expire mid-OAuth-flow during Google consent screen delays.
5. `X-Session-Type: demo` response header on every request enables demo banner without extra API calls.

**UX requirements demanded from backend:**
- `POST /auth/demo/start` response: `{ userId, expiresAt, sessionType: "demo" }`
- `X-Session-Type: demo|oauth` header on every authenticated response
- `410 Gone` on demo session expiry (not 401)
- Min 30-min TTL, configurable via env var
- Demo data persists TTL + 24 hours (grace period for upgrade flow)

### QA — Option 2

**Core thesis:** Deterministic expiry testing requires server-side state. Cookie expiry is browser-controlled and untestable from the server.

**Strongest points:**
1. With `demo_sessions` table: insert row with `expires_at` in the past, call cleanup, assert row gone. No `setTimeout`, no fake timers, no CI race conditions.
2. Data isolation directly assertable: query persistence layer to confirm demo data exists separately from real user data.
3. `/__e2e/demo-session` helper follows existing `/__e2e/oauth-session` pattern naturally.
4. Demo tests belong in `specs-oauth/` (AUTH_MODE=oauth). Option 2's server-side validation works cleanly in this config.
5. Cleanup testable as a unit — no browser needed, no time dependency, runs in <100ms.

**Test plan sketch:** 6 integration scenarios, 4 E2E scenarios, 3 unit scenarios.

---

## Round 2: Rebuttals & Resolution

### Frontend's 401 Problem — Resolved Without Option 2

**The counter:** The frontend INITIATED the demo flow. When the user clicks "Try it," the client-side handler can set `sessionStorage.setItem("isDemo", "true")` before the POST. When `redirectToLogoutOn401` fires, it checks this flag:

```ts
// In redirectToLogoutOn401 (api.ts)
if (sessionStorage.getItem("isDemo")) {
  sessionStorage.removeItem("isDemo");
  showDemoExpiredModal(); // or redirect to /login?demoExpired=true
  return;
}
window.location.href = `${API_BASE}/auth/logout`;
```

**Frontend's rebuttal attempt:** "Server components can't read sessionStorage." True, but `redirectToLogoutOn401` runs in the browser (it's in `api.ts` client-side wrappers). Server components use `getSession()` which returns null when the cookie is gone — the server component renders the login redirect.

**Frontend's second rebuttal:** "Multiple tabs share the cookie but not sessionStorage." Valid edge case, but minor: user opens demo in tab A, signs in with Google in tab B, tab A still thinks it's demo. Mitigation: the `is_demo` flag on the user row can be checked in `getSession()` server-side for SSR — this is a DB read that happens anyway via `loadUserStore`.

**Verdict:** Frontend concedes the 401 interception point. `sessionStorage` + `is_demo` column covers both client and server needs.

### Demo User Identification — Resolved via `is_demo` Column

The `is_demo` column on the `users` table (already in Option 1) provides server-side demo identification without a separate session table:

```ts
// In loadUserStore or a response hook
if (user.isDemo) {
  reply.header("X-Session-Type", "demo");
}
```

This is NOT a per-request auth check — it reads from already-loaded user data. `loadUserStore` is called by every protected route anyway. Adding one boolean check has zero measurable cost.

**Verdict:** Frontend's demo banner concern resolved. `X-Session-Type: demo` header is achievable within Option 1.

### QA's Testability — Resolved via `demo_expires_at` Column

**Backend's counter (accepted by QA):** The cleanup function with `is_demo=true` and `demo_expires_at` in the past IS deterministic:

```ts
// Integration test
await pool.query(`INSERT INTO users (..., is_demo, demo_expires_at) VALUES (..., true, NOW() - INTERVAL '1 hour')`);
const deleted = await cleanupExpiredDemoUsers(pool);
expect(deleted).toBe(1);
const remaining = await pool.query(`SELECT id FROM users WHERE is_demo = true`);
expect(remaining.rows).toHaveLength(0);
```

No time dependency. No cookie expiry simulation. The cleanup function is a pure SQL operation on Postgres state.

**QA's concession:** "The Backend is right that cleanup testing in Option 1 is deterministic. My testability objection was about cookie expiry, but cookie expiry is the browser's responsibility — the server tests its own cleanup logic. I retract the non-determinism argument."

**QA's remaining concern (addressed):** E2E demo session helper — Option 1 supports `/__e2e/demo-session` identically to `/__e2e/oauth-session`. Calls `resolveOrCreateUser("demo", ...)`, sets `is_demo=true`, signs cookie, returns it.

### Upgrade-to-Real-Account — Deferred

**Architect's position (accepted):** The upgrade flow is out of scope for KZO-107/108. The `is_demo` flag on the user row persists beyond cookie expiry (until cleanup runs), so a future ticket can implement migration by matching email or userId during the OAuth callback. The cleanup job's grace period (configurable, e.g., 1 hour after expiry) provides a window for upgrade.

**Frontend's concession:** "Upgrade flow is a separate ticket. I accept deferral if the schema supports it — the `is_demo` + `demo_expires_at` columns are sufficient for a future migration implementation."

### Option 3 — Rejected Unanimously

No debater advocated for Option 3. Key reasons:
- `MemoryPersistence` is a test harness, not production-ready (documented gaps)
- Per-request persistence routing violates the singleton `app.persistence` model
- Data loss on deploy is unacceptable UX for a conversion funnel
- Horizontal scaling requires sticky sessions
- "Zero cleanup" is illusory — stale session error handling distributes the complexity across every route handler

---

## Consensus: Option 1 Enhanced

### What We're Building

| Component | Detail |
|-----------|--------|
| **Schema** | `is_demo BOOLEAN DEFAULT false` + `demo_expires_at TIMESTAMPTZ` on `users` table. Partial index `WHERE is_demo = true`. |
| **Endpoint** | `POST /auth/demo/start` — guards on `DEMO_MODE_ENABLED` + non-production `DEPLOY_ENV`. Creates per-session demo user via `resolveOrCreateUser("demo", randomUUID(), ...)`. Signs HMAC cookie with `Max-Age=1800`. |
| **Data seeding** | Extend `ensureDefaultPortfolioData` or add `seedDemoTransactions` for sample holdings. |
| **Response header** | `X-Session-Type: demo` on every authenticated response when `user.isDemo === true`. Read from already-loaded user data — zero extra DB queries. |
| **Client-side tracking** | `sessionStorage.setItem("isDemo", "true")` on demo button click. Checked in `redirectToLogoutOn401` for demo-specific expiry UX. |
| **Cleanup** | `setInterval` in API process (15-min cycle). `DELETE` in FK dependency order for users with `is_demo = true AND demo_expires_at < NOW()`. |
| **Cookie** | Same `SESSION_COOKIE_NAME`, same HMAC signing as OAuth. Only difference: `Max-Age=1800` (30 min). |

### What We're NOT Building

- No `demo_sessions` table
- No per-request middleware or auth pipeline changes
- No changes to `resolveUserId()`, `app.ts`, or `registerRoutes.ts` auth logic
- No Redis session keys
- No `MemoryPersistence` routing
- No demo-to-real-account upgrade (future ticket)

### Open Items for Implementation

1. **`DEPLOY_ENV` env var** — Not in current `envSchema`. Needs to be added (or use existing `NODE_ENV` guard only).
2. **Demo data seeding** — What sample data? Transactions, holdings, accounts? How much? Enough to fill a dashboard but not overwhelming.
3. **Cookie Max-Age value** — 30 min proposed. Configurable via `DEMO_SESSION_TTL_SECONDS`?
4. **Cleanup grace period** — How long after `demo_expires_at` before data is deleted? 0 (immediate)? 1 hour? 24 hours (for future upgrade flow)?
5. **Rate limiting** — Current limiter is per-user. Demo endpoint is pre-auth. Need per-IP limiting or global throttle.
6. **`POST` vs `GET`** — Frontend needs `fetch()` + redirect (POST can't be an `<a>` tag). Or change to GET with CSRF protection.

---

## Arguments That Changed Minds

| Argument | From | Impact |
|----------|------|--------|
| `sessionStorage` flag for 401 interception | Architect (counter to Frontend) | Neutralized Frontend's strongest point — demo expiry UX achievable without server-side session |
| `is_demo` column enables `X-Session-Type` header without extra DB query | Backend (counter to Frontend) | Resolved demo banner identification within Option 1's architecture |
| Cleanup function with past-dated `demo_expires_at` is deterministic | Backend (counter to QA) | Neutralized QA's testability objection — no time-dependent tests needed |
| `fixer-scope-guardrail.md` precedent (24 E2E regressions from auth pipeline changes) | Architect (counter to Option 2) | Historical evidence that auth middleware changes are high-risk |
| Demo feature proportionality | Architect | The complexity budget for a demo feature should be near zero — strongest framing argument |

---

## Appendix: Vote Progression

| Role | Round 1 | Round 2 (Final) |
|------|---------|-----------------|
| Architect | Option 1 | Option 1 Enhanced |
| Backend | Option 1 | Option 1 Enhanced |
| Frontend | Option 2 | Option 1 Enhanced (conceded with conditions) |
| QA | Option 2 | Option 1 Enhanced (conceded with conditions) |

**Frontend conditions for concession:**
- `X-Session-Type: demo` header on every authenticated response
- `sessionStorage` pattern documented and implemented in `redirectToLogoutOn401`
- Demo expiry UX (modal or `/login?demoExpired=true` redirect) included in KZO-108

**QA conditions for concession:**
- Cleanup function tested with past-dated rows (deterministic)
- `/__e2e/demo-session` helper follows `/__e2e/oauth-session` pattern
- Demo E2E tests run under `playwright.oauth.config.ts` in `specs-oauth/`
