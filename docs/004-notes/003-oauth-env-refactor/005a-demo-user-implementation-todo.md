# Demo User Implementation TODO

**Tickets:** KZO-107 (backend, 5pts), KZO-108 (frontend, 3pts)
**Created:** 2026-03-22
**Completed:** 2026-03-23
**Debates:** `debates/01-04` (4 sessions, all resolved)

---

## Phase 0: Prerequisites

- [x] Add `DEMO_MODE_ENABLED: z.enum(["true","false"]).default("false")` to `envSchema` (`libs/config/src/env-schema.ts`)
- [x] Add `DEMO_SESSION_TTL_SECONDS: z.coerce.number().default(1800)` to `envSchema`
- [x] Add `DEMO_MODE_ENABLED` to `webEnvSchema` (for server-side read in Next.js Server Components)
- [x] Create migration `db/migrations/015_demo_user_columns.sql`:
  ```sql
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMP;
  CREATE INDEX IF NOT EXISTS idx_users_demo_cleanup ON users(demo_expires_at) WHERE is_demo = true;
  ```
- [x] Do NOT update `baseline_current_schema.sql` or `manifest.env`

---

## Phase 1: Cookie Format + Auth Pipeline (KZO-107)

### 1a. Cookie signing/verification (`apps/api/src/auth/googleOAuth.ts`)
- [x] `signSessionCookie(userId, secret, isDemo = false)` — add optional 3rd param
  - If `isDemo`: payload = `demo:${userId}`, else payload = `${userId}`
  - Sign HMAC over the full payload
- [x] `verifySessionCookie(cookieValue, secret)` → returns `{ userId, isDemo } | null`
  - Split on `lastIndexOf(".")` (unchanged)
  - Verify HMAC on full payload (unchanged)
  - After verification: check `payload.startsWith("demo:")`, strip prefix if present
  - Add code comment documenting HMAC invariant
- [x] Export `SessionIdentity` interface: `{ userId: string, isDemo: boolean }`

### 1b. Auth pipeline (`apps/api/src/routes/registerRoutes.ts`)
- [x] `parseSessionCookie` returns `SessionIdentity | null` (was `string | null`)
- [x] `resolveUserId` returns `{ userId, isDemo }` (was `string`)
  - Stashes `req.__sessionType = isDemo ? "demo" : "oauth"` on Fastify request
  - Update all 4-6 call sites to destructure `{ userId }` or `{ userId, isDemo }`
- [x] `loadUserStore` — return type stays `{ userId, store }` (no change)

### 1c. Request decoration + response header
- [x] `decorateRequest("__sessionType", null)` in `buildApp()` (`apps/api/src/app.ts`)
- [x] Add type declaration in `apps/api/src/types/fastify.d.ts`:
  ```ts
  declare module "fastify" {
    interface FastifyRequest {
      __sessionType?: "demo" | "oauth";
    }
  }
  ```
- [x] `onSend` hook in `app.ts`: if `req.__sessionType`, set `X-Session-Type` header

### 1d. Update existing tests (24 assertion changes)
- [x] `apps/api/test/unit/session-cookie.test.ts` — 9 assertions: `.toBe(string)` → `.toEqual({ userId: ..., isDemo: false })`
- [x] Add 3 new test cases for `demo:` prefix (sign, verify, round-trip)
- [x] `apps/api/test/integration/e2e-oauth-session.integration.test.ts` — 2 assertions + `verifiedUserId` variable
- [x] `apps/api/test/integration/oauth-identity-resolution.integration.test.ts` — `extractCookieUserId` return type + 10 downstream assertions
- [x] `apps/api/test/integration/auth-oauth.integration.test.ts` — 2 assertions

**Checkpoint:** `npm run lint && npm run test:unit && npm run test:integration:full:host` — all pass

---

## Phase 2: Persistence + Demo Endpoint (KZO-107)

### 2a. Persistence layer
- [x] Add `markDemoUser(userId: string, ttlSeconds: number): Promise<void>` to `Persistence` interface (`apps/api/src/persistence/types.ts`)
- [x] Implement in `PostgresPersistence` (`apps/api/src/persistence/postgres.ts`):
  ```ts
  async markDemoUser(userId: string, ttlSeconds: number): Promise<void> {
    await this.pool.query(
      `UPDATE users SET is_demo = true, demo_expires_at = NOW() + $2 * INTERVAL '1 second' WHERE id = $1`,
      [userId, ttlSeconds]
    );
  }
  ```
- [x] Implement in `MemoryPersistence` (`apps/api/src/persistence/memory.ts`):
  - Extend `MemoryUser` interface with `isDemo?: boolean`, `demoExpiresAt?: Date`
  - `markDemoUser` sets these fields on the in-memory user

### 2b. Demo data seeding
- [x] Create `apps/api/src/services/demoData.ts`
- [x] `seedDemoTransactions(persistence: Persistence, userId: string): Promise<void>`
  - Idempotent: check if user already has transactions, skip if yes
  - ~~Call `ensureDefaultPortfolioData(userId)` first~~ **Deviation:** Relies on `resolveOrCreateUser` having already called `ensureDefaultPortfolioData`, which creates the default account and fee profile. `seedDemoTransactions` reads the existing store instead.
  - Insert 10-15 deterministic BUY/SELL transactions across 5-6 symbols — **Actual: 12 transactions across 5 symbols (2330, 2317, 2454, 2881, 0050)**
  - Use existing symbols only — do NOT create `dividend_events` or `symbols` entries
  - All dates deterministic (e.g., relative to `new Date("2026-01-15")`)
  - **Deviation:** Uses `BookedTradeEvent` type and pushes to `store.accounting.facts.tradeEvents` (not `store.transactions` as sketched in design). This matches the actual store structure.

### 2c. Demo endpoint
- [x] Add `POST /auth/demo/start` route in `registerRoutes.ts`
  - Guard: `Env.DEMO_MODE_ENABLED !== "true"` → `routeError(404, "not_found", "not found")`
  - Per-IP rate limit: separate counter in existing rate limiter, keyed `${req.ip}:anonymous:POST:/auth/demo/start`, 5/min window
  - Body schema: `z.object({}).nullable().optional()`
  - ~~Atomic transaction (`BEGIN`/`COMMIT`/`ROLLBACK`)~~ **Deviation:** Non-atomic approach used (simpler). Operations are individually idempotent — orphaned users are harmless and cleaned up by the cleanup service.
    1. `resolveOrCreateUser("demo", demoId, { email, name })`
    2. `markDemoUser(userId, ttlSeconds)`
    3. `seedDemoTransactions(persistence, userId)`
  - Cookie signed AFTER successful operations
  - `signSessionCookie(userId, sessionSecret, true)` — demo prefix
  - Set-Cookie with `Max-Age=${ttlSeconds}`
  - Return `{ userId, expiresAt, sessionType: "demo" }`

### 2d. New integration tests
- [x] `apps/api/test/integration/demo-session.integration.test.ts`
  - Demo endpoint creates user and returns signed cookie
  - Demo user can access `/settings` with cookie
  - `X-Session-Type: demo` header present on responses
  - Endpoint returns 404 when `DEMO_MODE_ENABLED=false`
  - Rate limit enforced (6th request returns 429)
  - Demo data is seeded (non-empty store)

**Checkpoint:** `npm run lint && npm run test:unit && npm run test:integration:full:host` — all pass

---

## Phase 3: Cleanup (KZO-107)

### 3a. Cleanup function
- [x] Create `apps/api/src/services/demoCleanup.ts`
- [x] `cleanupExpiredDemoUsers(pool: Pool): Promise<number>`
  - Select expired demo user IDs: `WHERE is_demo = true AND demo_expires_at < NOW() - INTERVAL '1 hour'`
  - Early return 0 if no expired users
  - Single transaction (`BEGIN`/`COMMIT`/`ROLLBACK`)
  - 18 DELETEs in verified FK topological order (see debate note 04 appendix) — **Actual: 17 DELETEs (no `user_settings` table delete needed)**
  - Return count of deleted users
  - Log deletions

### 3b. Interval setup
- [x] In `apps/api/src/server.ts`:
  - Start `setInterval(cleanup, 15 * 60_000)` after app listen
  - Skip when `Env.PERSISTENCE_BACKEND === "memory"` — **Also guarded by `Env.DEMO_MODE_ENABLED === "true"`**
  - Store interval handle
  - Register `clearInterval` on Fastify `onClose` hook or process signal

### 3c. Cleanup tests
- [x] Integration test: create demo user with `demo_expires_at` in the past, call cleanup, assert deletion
- [x] Integration test: valid (non-expired) demo user is NOT deleted
- [x] Integration test: real user (`is_demo=false`) is NOT deleted

**Checkpoint:** Full test suite — `npm run lint && npm run test:unit && npm run test:integration:full:host` — all pass

---

## Phase 4: Frontend (KZO-108)

### 4a. getSession() update (`apps/web/lib/auth.ts`)
- [x] Update `Session` interface: `{ userId: string, isDemo: boolean }`
- [x] Parse `demo:` prefix from cookie value in oauth code path
- [x] Return `isDemo: true` if prefix present, `false` otherwise
- [x] HMAC verification unchanged (`lastIndexOf(".")` split handles `demo:` correctly)

### 4b. Update web tests
- [x] `apps/web/test/features/auth/getSession.test.ts` — 17 assertions: `toEqual({ userId })` → `toEqual({ userId, isDemo: false })`
- [x] Add test cases for demo cookie prefix round-trip

### 4c. Proxy route (`apps/web/app/api/demo/start/route.ts`)
- [x] POST proxy to `${SERVER_API_BASE_URL}/auth/demo/start`
- [x] Send `body: JSON.stringify({})` with `Content-Type: application/json`
- [x] Forward `Set-Cookie` via `res.headers.getSetCookie()` — **Deviation:** Uses `parseSetCookieHeader()` helper + `response.cookies.set()` (NextResponse cookies API) instead of raw header append, because Next.js can silently drop raw `Set-Cookie` headers. This is a more robust approach.
- [x] Return JSON body + status code
- [x] Catch: return `{ error: "upstream_error" }` with 502

### 4d. DemoButton component (`apps/web/components/DemoButton.tsx`)
- [x] Client component with `useState` for loading/error
- [x] `onClick`: sessionStorage → fetch → navigate (or show error)
- [x] `data-testid="demo-sign-in-button"`
- [x] Loading: disabled button, "Starting demo..."
- [x] Error: inline `<p role="alert">`

### 4e. Login page update (`apps/web/app/login/page.tsx`)
- [x] Read `WebEnv.DEMO_MODE_ENABLED` from `@tw-portfolio/config/web`
- [x] Conditionally render "or" divider + `<DemoButton>` below `<SignInButton>`
- [x] Read `searchParams.demoExpired` → show "Your demo session has ended" inline message

### 4f. Demo expiry UX (`apps/web/lib/api.ts`)
- [x] In `redirectToLogoutOn401`: check `sessionStorage.getItem("isDemo")`
- [x] If demo: remove flag, redirect to `/login?demoExpired=true`
- [x] If not demo: existing behavior (redirect to `/auth/logout`)

### 4g. Demo banner
- [x] `dashboard/page.tsx`: pass `session.isDemo` as prop to `AppShell` — **Also added to `portfolio/page.tsx` and `transactions/page.tsx`**
- [x] `AppShell`: render slim 32px bar above TopBar when `isDemo === true`
- [x] Text: "You're using a demo session."
- [x] No CTA link (deferred)

**Deviation:** Middleware exclusion added — `proxy.ts` matcher updated to exclude `/api/demo/*` paths so the demo start route is accessible without an existing session.

**Checkpoint:** `npm run lint && npm run test:unit` (web) — all pass

---

## Phase 5: E2E Tests (KZO-108)

### 5a. Config
- [x] Add `DEMO_MODE_ENABLED=true` to `playwright.oauth.config.ts` API server env block — **Also added to web server env block**

### 5b. E2E test file (`apps/web/tests/e2e/specs-oauth/auth-demo.spec.ts`)
- [x] Scenario 1: Click demo button → session created → lands on `/dashboard`
- [x] Scenario 2: Demo user sees seeded portfolio data (non-empty)
- [x] Scenario 3: Demo data isolated from real OAuth user
- [x] Scenario 4: `sessionStorage.isDemo` flag is set (use `page.waitForURL` before asserting)
- [x] Scenario 5: Demo button shows error when disabled (mock proxy via `page.route`)
- [x] Scenario 6: Rate limit feedback (mock proxy returns 429)
- [x] Scenario 7: Demo banner visible on dashboard
- [x] Scenario 8: Login page hides button when DEMO_MODE_ENABLED=false

### 5c. Additional test coverage
- [x] Add `proxy.ts` demo cookie verification test case

**Checkpoint:** Full test suite — all 5 commands pass:
```
npm run lint
npm run test:unit
npm run test:integration:full:host
npm run test:e2e:bypass:mem
npm run test:e2e:oauth:mem
```

---

## Explicitly Deferred (out of scope)

- Demo expiry modal component (use redirect + inline message)
- Demo banner "Sign in to keep your work" CTA (upgrade flow)
- `proxy.ts` demo session awareness (redirect goes to `/auth/error` not `/login?demoExpired`)
- `X-Session-Type` header consumption in CSR API wrappers
- `dividend_events` in demo seed data
- Rich demo data (30+ transactions, corporate actions)
- Upgrade-to-real-account flow (data migration)
- `ON DELETE CASCADE` on user FKs
