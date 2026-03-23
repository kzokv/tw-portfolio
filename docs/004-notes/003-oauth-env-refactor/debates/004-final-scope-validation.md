# Final Scope Validation — Debate Meeting Note

**Date:** 2026-03-22
**Tickets:** KZO-107, KZO-108
**Participants:** Architect, Backend, Frontend, QA, DBA
**Facilitator:** Team Lead

---

## Purpose

All prior debates resolved individual design branches. This session validates the **complete locked-in scope** for implementation readiness. Each role reviewed the full spec for contradictions, gaps, risks, and deferral opportunities.

---

## Consolidated Findings

### BLOCKERS (must resolve before implementation)

| # | Blocker | Raised By | Resolution |
|---|---------|-----------|------------|
| B1 | **Cookie format change contradicts debate #1 consensus** — Debate #1 said "No changes to `resolveUserId()`, `app.ts`, or `registerRoutes.ts` auth logic." Debate #3 chose cookie-encoded `demo:` prefix which changes all three. | Architect | **Resolved: Debate #3 supersedes.** The "no auth changes" constraint in debate #1 addressed the *cleanup strategy* (no per-request middleware). Debate #3 addressed a *different question* (how to propagate `isDemo`). The cookie format change is additive — `resolveUserId` return type widens, but its auth enforcement logic (HMAC verify, 401 on missing cookie) is unchanged. Update debate #1 note to clarify the supersession. |
| B2 | **`@fastify/rate-limit` is not installed** — Scope says "per-route config via `@fastify/rate-limit`" but package is not a dependency. | Architect, Backend | **Resolved: Use existing hand-rolled rate limiter.** The current `app.ts` (lines 95-115) has an in-memory `Map<string, RateCounter>` keyed on `${ip}:${userId}:${method}:${path}`. Add a separate IP-only counter for the demo endpoint: `${ip}:anonymous:POST:/auth/demo/start` with a 5/min window. No new dependency. |
| B3 | **Exact FK delete ordering must be specified — 18 statements, not "15+"** | DBA, Backend | **Resolved: DBA provided verified ordering.** See appendix. The cleanup function must execute all 18 DELETEs in the specified topological order within a single `BEGIN`/`COMMIT` transaction. |
| B4 | **Cleanup MUST run in a single transaction** | DBA | **Resolved: Required.** Partial failure leaves orphaned rows. The existing `saveAccountingStoreTx` pattern (postgres.ts:904-912) demonstrates the correct `client.query("BEGIN")` / `client.query("COMMIT")` approach. Cleanup uses the same pattern. |
| B5 | **`verifySessionCookie` return type change breaks ~24 existing test assertions** | QA | **Resolved: Include exhaustive inventory in implementation spec.** Files affected: `session-cookie.test.ts` (9), `e2e-oauth-session.integration.test.ts` (2 + `verifiedUserId` usage), `oauth-identity-resolution.integration.test.ts` (`extractCookieUserId` return type + 10 downstream), `auth-oauth.integration.test.ts` (2). All are mechanical `.toBe(string)` → `.toEqual({ userId, isDemo: false })` changes. TypeScript catches them at compile time. |
| B6 | **`X-Session-Type` header missing on 5 routes** — Routes calling `resolveUserId` directly (not through `loadUserStore`) won't have `req.__sessionType` set: `/profile GET/PATCH`, `/portfolio/transactions POST`, `/portfolio/dividends/postings POST`, `/__e2e/reset`. | QA | **Resolved: Stash `isDemo` inside `resolveUserId` itself.** Since `resolveUserId` already returns `{ userId, isDemo }` (per debate #3), it can also do `(req as any).__sessionType = isDemo ? "demo" : "oauth"`. This covers ALL authenticated routes, not just `loadUserStore` routes. Requires passing `req` to `resolveUserId` (it already receives it). |
| B7 | **`DEMO_MODE_ENABLED` not in any env schema yet** | Frontend | **Resolved: Add to both schemas.** `envSchema`: `DEMO_MODE_ENABLED: z.enum(["true","false"]).default("false")`. `webEnvSchema`: same key (server-side only, read by Server Component via `WebEnv`). Do NOT use `NEXT_PUBLIC_*` prefix. |
| B8 | **Race condition in multi-step demo user creation** | Backend | **Resolved: Atomic creation.** The `POST /auth/demo/start` handler should use a transaction: `BEGIN` → `resolveOrCreateUser` → `markDemoUser` → `seedDemoTransactions` → `COMMIT`. If any step fails, `ROLLBACK` — no orphaned half-baked demo users. The cookie is only signed and returned after COMMIT succeeds. |

---

### CONCERNS (spec clarifications, not blockers)

| # | Concern | Raised By | Resolution |
|---|---------|-----------|------------|
| C1 | **`TIMESTAMPTZ` vs `TIMESTAMP` inconsistency** — All existing time columns use `TIMESTAMP`. Scope proposes `demo_expires_at TIMESTAMPTZ` — would be the only `TIMESTAMPTZ` in the schema. | DBA | **Use `TIMESTAMP` for consistency.** The server runs UTC (Docker default). TTL arithmetic works correctly with `TIMESTAMP`. |
| C2 | **`dividend_events` and `symbols` are shared tables** — No `user_id` column. Cleanup cannot delete them by user. If demo seeding creates entries in these tables, deletion could break other users. | DBA | **Use real symbols, don't seed `dividend_events` or `symbols`.** Demo transactions reference existing symbols (populated by quote polling or pre-seeded). The `seedDemoTransactions` function only creates user-scoped data: `trade_events`, `lot_allocations`, `cash_ledger_entries`. No `dividend_events` in MVP. |
| C3 | **`(req as any).__sessionType` should use `decorateRequest`** | Backend | **Agreed.** Use `app.decorateRequest("__sessionType", null)` in `buildApp()`. Add type declaration in `apps/api/src/types/fastify.d.ts`: `__sessionType?: "demo" \| "oauth"`. |
| C4 | **`seedDemoTransactions` location and idempotency** | Architect, Backend | **Place in `apps/api/src/services/demoData.ts`.** Make idempotent: check if user already has transactions before inserting. Calls `ensureDefaultPortfolioData` first (for account + fee profile), then inserts deterministic transactions. |
| C5 | **Empty POST body Content-Type** — Fastify 5 rejects empty string body with `Content-Type: application/json`. | Backend | **Proxy sends `body: JSON.stringify({})`.** Demo route schema: `z.object({}).nullable().optional()`. Consistent with `/__e2e/oauth-session` pattern (line 397). |
| C6 | **`getSession()` return type change breaks 17 web test assertions** | Frontend, QA | **Mechanical update.** All `toEqual({ userId: "..." })` → `toEqual({ userId: "...", isDemo: false })`. Include in implementation checklist. |
| C7 | **`Env.DEMO_MODE_ENABLED` wrong import path for web** | Frontend | **Use `WebEnv.DEMO_MODE_ENABLED`** from `@tw-portfolio/config/web`. The main `@tw-portfolio/config` entry point uses `node:fs` (crashes in Edge Runtime). Add `DEMO_MODE_ENABLED` to `webEnvSchema`. |
| C8 | **`DEMO_MODE_ENABLED=true` needed in `playwright.oauth.config.ts`** | QA | **Add to API server env block** in the Playwright config. Without this, demo endpoint returns 404 and all demo E2E tests fail silently. |
| C9 | **Cleanup `setInterval` lifecycle** — Must clear on shutdown, must not run during tests. | Backend | **Place interval in `server.ts` (not `buildApp`).** Register `clearInterval` in Fastify `onClose` hook. Integration tests import `buildApp()` directly — interval never starts. Skip interval when `PERSISTENCE_BACKEND=memory`. |
| C10 | **Web `proxy.ts` HMAC verification for `demo:` prefix** | Backend | **Already compatible.** `proxy.ts` splits on `lastIndexOf(".")` and verifies the full pre-dot payload. `demo:{uuid}` is the full payload — HMAC verifies correctly. No changes needed, but add a test case. |
| C11 | **Demo banner placement** | Frontend | **Pass `isDemo` as prop from Server Component page to `AppShell`.** `dashboard/page.tsx` calls `requireSession()` which returns `{ userId, isDemo }`. Pass `isDemo` to `AppShell` which renders banner above `TopBar`. |
| C12 | **`signSessionCookie` HMAC semantics documentation** | Backend | **Add code comment** in `googleOAuth.ts` documenting the invariant: HMAC signs full payload including `demo:` prefix. Stripping or adding prefix invalidates signature. |

---

### DEFERRAL CANDIDATES

| # | Item | Raised By | Impact of Deferral | Recommendation |
|---|------|-----------|-------------------|----------------|
| D1 | Demo expiry modal component | Architect | Demo users redirect to `/login?demoExpired=true` with inline message instead of a styled modal. Functional, less polished. | **Defer.** Redirect with query param is sufficient for MVP. Login page reads `searchParams.demoExpired` and shows inline message. |
| D2 | `X-Session-Type` header consumption on CSR | Frontend | CSR demo detection relies on `sessionStorage` (set on demo button click) and SSR detection via `getSession().isDemo`. The response header becomes redundant. | **Keep in scope.** Implementation cost is 3 lines in `onSend` hook. Provides defense-in-depth for edge cases (e.g., new tab without sessionStorage). |
| D3 | Demo banner "Sign in to keep your work" CTA | Frontend | Banner shows "Demo session" text but no conversion CTA. Upgrade-to-real-account flow is a separate feature. | **Defer.** Banner text: "You're using a demo session." No action link until upgrade flow is built. |
| D4 | `proxy.ts` demo session awareness | Frontend | `proxy.ts` redirect on auth failure goes to `/auth/error?reason=session_expired` instead of `/login?demoExpired=true`. Minor UX inconsistency. | **Defer.** `proxy.ts` already works correctly (redirects on auth failure). The demo-specific redirect is a client-side concern handled by `redirectToLogoutOn401`. |
| D5 | `dividend_events` in demo seed data | DBA | Demo user sees no dividend data. Dashboard shows holdings and trade history only. | **Defer.** Dividends require shared `dividend_events` table entries and cleanup complexity. Add in a follow-up ticket. |
| D6 | Rich demo data (30+ transactions) | Architect | Dashboard shows 5-8 trades across 2-3 symbols. Sufficient to demonstrate the product. | **Keep moderate scope** (10-15 transactions, 5-6 symbols, buys and sells only). |

---

### APPROVED (no concerns)

| Item | Approved By |
|------|-------------|
| `DEMO_MODE_ENABLED` as sole guard (no `DEPLOY_ENV`) | All |
| `DEMO_SESSION_TTL_SECONDS` with default 1800 | All |
| `is_demo BOOLEAN NOT NULL DEFAULT false` migration (safe on Pg 11+) | DBA |
| Partial index `WHERE is_demo = true` | DBA |
| `demo-${uuid}@demo.local` email format (zero collision risk) | DBA |
| `resolveOrCreateUser("demo", ...)` reuse (no persistence changes needed) | Architect |
| Per-IP rate limit using existing hand-rolled limiter | Architect, Backend |
| `DemoButton` client component mirroring `SignInButton` pattern | Frontend |
| Next.js proxy at `/api/demo/start` following `/api/profile` pattern | Frontend, Architect |
| `window.location.href = "/dashboard"` (full reload, correct for fresh cookie) | Frontend |
| `sessionStorage.setItem("isDemo")` for CSR 401 interception | Frontend, QA |
| E2E tests under `playwright.oauth.config.ts` in `specs-oauth/` | QA |
| Cleanup `setInterval` in `server.ts` (not `buildApp`) | Backend, QA |
| No demo user restrictions (full access on ephemeral data) | All |
| Migration auto-discovery by `loadMigrationManifest` | QA |
| Data volume non-concern (2,250 rows worst case) | DBA |
| `NOW()` timezone consistency with `TIMESTAMP` columns | DBA |

---

## Updated Scope (post-validation)

Changes from the pre-validation locked scope:

| # | Original | Updated |
|---|----------|---------|
| 1 | `@fastify/rate-limit` per-route config | Use existing hand-rolled rate limiter with IP-only key |
| 2 | `(req as any).__sessionType` | Use `decorateRequest("__sessionType", null)` + type declaration |
| 3 | `demo_expires_at TIMESTAMPTZ` | `demo_expires_at TIMESTAMP` (consistency with existing schema) |
| 4 | "15+ DELETE queries" | Exactly 18 DELETEs in verified topological order (see appendix) |
| 5 | Cleanup as separate statements | Cleanup wrapped in `BEGIN`/`COMMIT` transaction |
| 6 | `Env.DEMO_MODE_ENABLED` in web server component | `WebEnv.DEMO_MODE_ENABLED` from `@tw-portfolio/config/web` |
| 7 | `seedDemoTransactions` creates dividend events | No `dividend_events` — trades and cash ledger entries only |
| 8 | Demo expiry modal component | Redirect to `/login?demoExpired=true` with inline message |
| 9 | `isDemo` stashed in `loadUserStore` only | `isDemo` stashed in `resolveUserId` itself (covers all routes) |
| 10 | Multi-step demo creation (no transaction) | Atomic: `BEGIN` → create → mark → seed → `COMMIT` → sign cookie |
| 11 | Proxy sends empty body | Proxy sends `body: JSON.stringify({})` with `Content-Type: application/json` |
| 12 | Add `DEMO_MODE_ENABLED` to `envSchema` only | Add to both `envSchema` AND `webEnvSchema` |

---

## Implementation Checklist (from all roles)

### Pre-implementation
- [ ] Add `DEMO_MODE_ENABLED` + `DEMO_SESSION_TTL_SECONDS` to `envSchema`
- [ ] Add `DEMO_MODE_ENABLED` to `webEnvSchema`
- [ ] Create migration `015_demo_user_columns.sql`

### Backend (KZO-107)
- [ ] `signSessionCookie(userId, secret, isDemo?)` — optional 3rd param
- [ ] `verifySessionCookie` → returns `{ userId, isDemo } | null`
- [ ] `resolveUserId` → returns `{ userId, isDemo }`, stashes `req.__sessionType`
- [ ] `decorateRequest("__sessionType", null)` in `buildApp()`
- [ ] Type declaration in `fastify.d.ts`
- [ ] `onSend` hook reads `req.__sessionType`, sets `X-Session-Type` header
- [ ] `POST /auth/demo/start` route handler (atomic transaction)
- [ ] `markDemoUser(userId, ttlSeconds)` on Persistence interface + both implementations
- [ ] `seedDemoTransactions` in `services/demoData.ts` (idempotent, deterministic)
- [ ] `cleanupExpiredDemoUsers` in `services/demoCleanup.ts` (18 DELETEs, single transaction)
- [ ] `setInterval` in `server.ts` + `clearInterval` on close
- [ ] Per-IP rate limit on demo endpoint using existing limiter

### Frontend (KZO-108)
- [ ] `getSession()` parses `demo:` prefix, returns `{ userId, isDemo }`
- [ ] `DemoButton` component
- [ ] `/api/demo/start` proxy route
- [ ] Login page conditional rendering with `WebEnv.DEMO_MODE_ENABLED`
- [ ] `redirectToLogoutOn401` demo expiry check via `sessionStorage`
- [ ] `/login?demoExpired=true` inline message
- [ ] Demo banner in `AppShell` (prop from Server Component)

### Tests
- [ ] Update `session-cookie.test.ts` (9 assertions)
- [ ] Update `e2e-oauth-session.integration.test.ts` (2 assertions + variable type)
- [ ] Update `oauth-identity-resolution.integration.test.ts` (`extractCookieUserId` + 10 assertions)
- [ ] Update `auth-oauth.integration.test.ts` (2 assertions)
- [ ] Update `getSession.test.ts` (17 assertions)
- [ ] New: demo-session integration tests
- [ ] New: cleanup function integration test
- [ ] New: `specs-oauth/auth-demo.spec.ts` E2E tests
- [ ] Add `DEMO_MODE_ENABLED=true` to `playwright.oauth.config.ts`
- [ ] Add `proxy.ts` demo cookie verification test case

---

## Appendix: Verified FK Delete Ordering

Provided by DBA. All 18 statements execute within a single transaction.

```sql
BEGIN;

-- Collect target user IDs
-- $1 = array of user IDs from: SELECT id FROM users WHERE is_demo = true AND demo_expires_at < NOW() - INTERVAL '1 hour'

-- 1. Leaf tables first
DELETE FROM recompute_job_items WHERE job_id IN (SELECT id FROM recompute_jobs WHERE user_id = ANY($1));
DELETE FROM cash_ledger_entries WHERE user_id = ANY($1);
DELETE FROM dividend_deduction_entries WHERE dividend_ledger_entry_id IN (SELECT id FROM dividend_ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1)));
DELETE FROM dividend_ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1));
DELETE FROM lot_allocations WHERE user_id = ANY($1);

-- 6. Self-referencing tables (single-statement DELETE handles self-refs)
DELETE FROM trade_events WHERE user_id = ANY($1);

-- 7. Snapshot tables (CASCADE handles tax_components)
DELETE FROM trade_fee_policy_snapshots WHERE user_id = ANY($1);

-- 8. Account-scoped tables without user_id
DELETE FROM lots WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1));
DELETE FROM corporate_actions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1));

-- 10. Standalone user-scoped tables
DELETE FROM reconciliation_records WHERE user_id = ANY($1);
DELETE FROM daily_portfolio_snapshots WHERE user_id = ANY($1);
DELETE FROM recompute_jobs WHERE user_id = ANY($1);

-- 13. Account deletion (CASCADE handles account_fee_profile_overrides)
DELETE FROM accounts WHERE user_id = ANY($1);

-- 14. Fee profiles (CASCADE handles fee_profile_tax_rules)
DELETE FROM fee_profile_tax_rules WHERE user_id = ANY($1);
DELETE FROM fee_profiles WHERE user_id = ANY($1);

-- 16. Identity + user
DELETE FROM user_external_identities WHERE user_id = ANY($1);
DELETE FROM users WHERE id = ANY($1);

COMMIT;
```

**Key ordering constraints:**
- `cash_ledger_entries` before `trade_events` (FK `related_trade_event_id`)
- `cash_ledger_entries` before `dividend_ledger_entries` (FK `related_dividend_ledger_entry_id`)
- `dividend_deduction_entries` before `dividend_ledger_entries` (FK `dividend_ledger_entry_id`)
- `lot_allocations` before `trade_events` (FK `trade_event_id`)
- `recompute_job_items` before `trade_events` (FK `trade_event_id`)
- `trade_events` before `trade_fee_policy_snapshots` (FK `fee_policy_snapshot_id`)
- `trade_events` before `accounts` (FK `account_id`)
- `lots` before `accounts` (FK `account_id`)
- `accounts` before `fee_profiles` (FK `fee_profile_id`)
- `fee_profile_tax_rules` before `fee_profiles` (explicit, though CASCADE would handle)

**Excluded from cleanup:** `dividend_events`, `symbols`, `symbol_bindings` — shared reference tables with no `user_id` column. Demo seeding must not create entries in these tables.
