# Transition Guide — Demo User Feature (KZO-107, KZO-108)

> Covers: KZO-107 (backend, 5pts), KZO-108 (frontend, 3pts)
> Date: 2026-03-23
> Status: Frozen — for current behavior, see `docs/runbook.md`

This guide covers the demo user feature added to the tw-portfolio stack. If you last worked on the codebase before these changes shipped, read this to understand what changed.

---

## What Was Added

### New env vars

| Variable | Schema | Default | Where |
|----------|--------|---------|-------|
| `DEMO_MODE_ENABLED` | `z.enum(["true", "false"])` | `"false"` | `envSchema` + `webEnvSchema` |
| `DEMO_SESSION_TTL_SECONDS` | `z.coerce.number().int().positive()` | `1800` (30 min) | `envSchema` only |

Both are optional with defaults. Demo mode is off unless explicitly enabled.

`DEMO_MODE_ENABLED` is in `webEnvSchema` so Server Components can conditionally render the demo button on the login page. It is server-side only (no `NEXT_PUBLIC_` prefix).

### New database migration (`db/migrations/015_demo_user_columns.sql`)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_users_demo_cleanup ON users(demo_expires_at) WHERE is_demo = true;
```

- `is_demo` flags demo users for cleanup
- `demo_expires_at` is `TIMESTAMP` (not `TIMESTAMPTZ`) for consistency with existing columns
- Partial index scans only demo users during cleanup queries
- Auto-discovered by `loadMigrationManifest` (file pattern match)

### New API endpoint: `POST /auth/demo/start`

Creates a demo user session. Registered in `registerRoutes.ts`.

**Guard:** Returns 404 when `DEMO_MODE_ENABLED !== "true"`.

**Rate limit:** 5 requests per minute per IP, using a dedicated `demoRateBuckets` Map in `registerRoutes.ts` (separate from the existing mutation rate limiter).

**Flow:**
1. Generate a UUID-based demo identity (`demo-{uuid}@demo.local`)
2. `resolveOrCreateUser("demo", demoId, { email, name: "Demo User" })`
3. `markDemoUser(userId, ttlSeconds)` — sets `is_demo = true` and `demo_expires_at`
4. `seedDemoTransactions(persistence, userId)` — 12 deterministic BUY/SELL transactions across 5 symbols (2330, 2317, 2454, 2881, 0050)
5. Sign session cookie with demo prefix: `signSessionCookie(userId, sessionSecret, true)`
6. Set `Set-Cookie` with `Max-Age=${ttlSeconds}`

**Response:** `{ userId, expiresAt, sessionType: "demo" }`

**Non-atomic:** Operations are individually idempotent. If `markDemoUser` or `seedDemoTransactions` fails, the orphaned user is harmless and cleaned up by the cleanup service.

### Cookie format change: `demo:` prefix

Session cookies now carry identity metadata in the payload:

| Cookie type | Payload format | Example |
|-------------|---------------|---------|
| OAuth (unchanged) | `{userId}.{hmac}` | `abc-123.fa4b2c...` |
| Demo (new) | `demo:{userId}.{hmac}` | `demo:abc-123.8e1d5a...` |

The HMAC signs the **full payload** including the `demo:` prefix. Stripping or adding the prefix invalidates the signature — tamper-proof by construction.

### New type: `SessionIdentity`

Exported from `apps/api/src/auth/googleOAuth.ts`:

```ts
export interface SessionIdentity {
  userId: string;
  isDemo: boolean;
}
```

### Auth pipeline return type changes

| Function | Before | After |
|----------|--------|-------|
| `verifySessionCookie()` | `string \| null` | `SessionIdentity \| null` |
| `parseSessionCookie()` | `string \| null` | `SessionIdentity \| null` |
| `resolveUserId()` | `string` | `{ userId: string; isDemo: boolean }` |
| `loadUserStore()` | `{ userId, store }` | `{ userId, store }` (unchanged — destructures `userId` from `resolveUserId`) |

All existing call sites in `registerRoutes.ts` were updated to destructure `{ userId }` from the new return type.

### `X-Session-Type` response header

Every authenticated API response now includes an `X-Session-Type` header:

- `X-Session-Type: oauth` — regular OAuth session
- `X-Session-Type: demo` — demo session

Set via `onSend` hook in `app.ts`, reading `req.__sessionType` (decorated on the Fastify request by `resolveUserId`).

### `Session` interface change (web)

`apps/web/lib/auth.ts`:

```ts
// Before
export interface Session { userId: string }

// After
export interface Session { userId: string; isDemo: boolean }
```

`getSession()` now returns `{ userId, isDemo }`. The `isDemo` flag is derived from the `demo:` prefix in the session cookie payload, using the same HMAC verification logic.

### Persistence layer additions

New method on `Persistence` interface (`apps/api/src/persistence/types.ts`):

```ts
markDemoUser(userId: string, ttlSeconds: number): Promise<void>;
```

Implemented in both `PostgresPersistence` (SQL UPDATE) and `MemoryPersistence` (in-memory field set).

`PostgresPersistence` also exposes `getPool(): Pool` for the cleanup service.

### Demo cleanup service (`apps/api/src/services/demoCleanup.ts`)

`cleanupExpiredDemoUsers(pool: Pool): Promise<number>` deletes expired demo users and all their data:

- Selects users where `is_demo = true AND demo_expires_at < NOW() - INTERVAL '1 hour'` (1-hour grace period)
- Single transaction with 17 DELETEs in FK topological order
- Returns count of deleted users
- Logs deletions to console

**Interval:** Started in `server.ts` as `setInterval(cleanup, 15 * 60_000)` (every 15 minutes). Only active when `PERSISTENCE_BACKEND === "postgres"` AND `DEMO_MODE_ENABLED === "true"`. Cleared on Fastify `onClose`.

### Demo data seeding (`apps/api/src/services/demoData.ts`)

`seedDemoTransactions(persistence, userId)` creates 12 deterministic transactions:

- 5 symbols: TSMC (2330), Hon Hai (2317), MediaTek (2454), Fubon FHC (2881), 0050 ETF
- Mix of BUY and SELL across Jan-Mar 2026
- Idempotent: skips if user already has trade events
- Uses `BookedTradeEvent` type, pushes to `store.accounting.facts.tradeEvents`

### Frontend: DemoButton component (`apps/web/components/DemoButton.tsx`)

Client component with loading/error states:

1. Sets `sessionStorage.isDemo = "true"`
2. `POST /api/demo/start` (Next.js proxy route)
3. On success: navigates to `/dashboard`
4. On failure: removes sessionStorage flag, shows inline error
5. Rate limit (429): "Too many demo sessions. Please wait a minute and try again."

`data-testid="demo-sign-in-button"` for E2E targeting.

### Frontend: Proxy route (`apps/web/app/api/demo/start/route.ts`)

Next.js route handler that proxies to the API's `/auth/demo/start`:

- Uses `SERVER_API_BASE_URL` (Docker container network) or falls back to `NEXT_PUBLIC_API_BASE_URL`
- Forwards `Set-Cookie` headers using `parseSetCookieHeader()` + `response.cookies.set()` (NextResponse cookies API) instead of raw header append — Next.js can silently drop raw `Set-Cookie` headers
- Error fallback: returns `{ error: "upstream_error" }` with 502

### Frontend: Login page changes (`apps/web/app/login/page.tsx`)

- Reads `WebEnv.DEMO_MODE_ENABLED` server-side
- Conditionally renders "or" divider + `<DemoButton>` below `<SignInButton>` when enabled
- Accepts `?demoExpired` query param to show "Your demo session has ended. Sign in to keep your data."

### Frontend: Demo expiry UX (`apps/web/lib/api.ts`)

`redirectToLogoutOn401` now checks `sessionStorage.getItem("isDemo")`:

- Demo session: removes flag, redirects to `/login?demoExpired=true`
- OAuth session: existing behavior (redirects to `/auth/logout`)

### Frontend: Demo banner (`apps/web/components/layout/AppShell.tsx`)

All protected pages (`dashboard`, `portfolio`, `transactions`) pass `session.isDemo` to `AppShell`. When `isDemo === true`, a slim 32px amber banner renders above the TopBar:

> You're using a demo session.

`data-testid="demo-banner"` for E2E targeting.

### Frontend: Middleware exclusion (`apps/web/proxy.ts`)

The auth middleware matcher now excludes `/api/demo/*` paths so the demo start proxy route is accessible without an existing session:

```ts
matcher: [
  "/((?!login|auth/error|api/demo|_next/|favicon\\.ico|robots\\.txt|manifest\\.json|.*\\..*).*)",
]
```

### E2E test config (`apps/web/tests/e2e/playwright.oauth.config.ts`)

`DEMO_MODE_ENABLED=true` added to both API and web server env blocks in the OAuth Playwright config.

---

## What's Unchanged

| Aspect | Still works the same way |
|--------|------------------------|
| OAuth login flow | Google consent -> callback -> HMAC session cookie (no `demo:` prefix) |
| `dev_bypass` mode | Returns `{ userId: "user-1", isDemo: false }` — no demo awareness |
| `proxy.ts` HMAC verification | `lastIndexOf(".")` split handles `demo:` prefix correctly |
| Existing rate limiter | Mutation rate limit unchanged; demo uses a separate bucket |
| `loadUserStore()` return type | Still `{ userId, store }` |
| Bypass E2E tests | No demo tests in bypass suite |
| `baseline_current_schema.sql` | Not updated — migration-only change |

---

## Before/After Comparison

### Cookie verification

| Before | After |
|--------|-------|
| `verifySessionCookie()` returns `string \| null` | Returns `SessionIdentity \| null` (`{ userId, isDemo }`) |
| No demo prefix handling | Detects `demo:` prefix after HMAC verification |

### Auth pipeline

| Before | After |
|--------|-------|
| `resolveUserId()` returns `string` | Returns `{ userId: string; isDemo: boolean }` |
| No `__sessionType` on request | `req.__sessionType` set to `"demo"` or `"oauth"` |
| No `X-Session-Type` header | Header set on every authenticated response |

### Session interface (web)

| Before | After |
|--------|-------|
| `Session = { userId: string }` | `Session = { userId: string; isDemo: boolean }` |
| `getSession()` returns `{ userId }` | Returns `{ userId, isDemo }` |
| `requireSession()` returns `Session` | Returns updated `Session` (with `isDemo`) |

### Login page

| Before | After |
|--------|-------|
| Google sign-in button only | Google sign-in + optional demo button (when `DEMO_MODE_ENABLED=true`) |
| No demo expiry messaging | Shows "Your demo session has ended" when `?demoExpired` param present |

### 401 handling (client)

| Before | After |
|--------|-------|
| Always redirects to `/auth/logout` | Demo: redirects to `/login?demoExpired=true`; OAuth: unchanged |

---

## Migration Steps

### Enabling demo mode

Set the env vars and restart the API + web servers:

```bash
# In .env.local or the appropriate env file:
DEMO_MODE_ENABLED=true
DEMO_SESSION_TTL_SECONDS=1800  # optional, default 30 min
```

For Postgres backends, run the migration first:

```bash
# The migration is auto-discovered — just restart or run the migrate container
npm run dev:docker -- --migrate
```

### Disabling demo mode

Set `DEMO_MODE_ENABLED=false` (or remove it — default is `"false"`). The demo button disappears from the login page, and `POST /auth/demo/start` returns 404. Existing demo sessions continue until they expire; the cleanup service removes their data.

### If you consume `verifySessionCookie()` or `resolveUserId()`

These now return objects instead of strings. Update call sites to destructure:

```ts
// Before
const userId = verifySessionCookie(cookie, secret);
// After
const identity = verifySessionCookie(cookie, secret);
if (identity) {
  const { userId, isDemo } = identity;
}
```

### If you consume `getSession()` in the web app

The return type is now `{ userId: string; isDemo: boolean }`. If you only need `userId`, destructure it:

```ts
const session = await getSession();
if (session) {
  const { userId } = session;  // isDemo available if needed
}
```

### If you add new protected pages

Pass `session.isDemo` to `AppShell` to show the demo banner:

```tsx
const session = await requireSession();
return <AppShell section="your-section" isDemo={session.isDemo} />;
```

---

## New Files

| File | Purpose |
|------|---------|
| `db/migrations/015_demo_user_columns.sql` | Adds `is_demo` and `demo_expires_at` columns to `users` |
| `apps/api/src/services/demoData.ts` | Deterministic demo transaction seeding |
| `apps/api/src/services/demoCleanup.ts` | Expired demo user cleanup (17 DELETEs in FK order) |
| `apps/web/app/api/demo/start/route.ts` | Next.js proxy route for demo start |
| `apps/web/components/DemoButton.tsx` | Client component for demo sign-in button |
| `apps/api/test/integration/demo-session.integration.test.ts` | Demo endpoint integration tests |
| `apps/api/test/integration/demo-cleanup.integration.test.ts` | Cleanup service integration tests |
| `apps/web/tests/e2e/specs-oauth/auth-demo.spec.ts` | Demo feature E2E tests |

---

## Tickets in This Arc

| Ticket | Title | Status |
|--------|-------|--------|
| KZO-107 | Demo user backend — cookie format, auth pipeline, persistence, endpoint, cleanup | Complete |
| KZO-108 | Demo user frontend — DemoButton, proxy route, login page, banner, expiry UX | Complete |
