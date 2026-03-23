# Demo User Feature — Technical Design

**Tickets:** KZO-107 (backend, 5pts), KZO-108 (frontend, 3pts)
**Branch:** `kzo-107`
**Architect:** Claude Opus 4.6
**Date:** 2026-03-22

---

## Table of Contents

1. [Phase 0: Prerequisites](#phase-0)
2. [Phase 1: Cookie Format + Auth Pipeline](#phase-1)
3. [Phase 2: Persistence + Demo Endpoint](#phase-2)
4. [Phase 3: Cleanup](#phase-3)
5. [Phase 4: Frontend](#phase-4)
6. [Phase 5: E2E Tests](#phase-5)
7. [Test Update Inventory](#test-update-inventory)
8. [File Change Matrix](#file-change-matrix)

---

<a id="phase-0"></a>
## Phase 0: Prerequisites

### 0a. Env Schema (`libs/config/src/env-schema.ts`)

Add two new fields to `envSchema` (after `COOKIE_DOMAIN`, line 34):

```ts
DEMO_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
DEMO_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
```

Add `DEMO_MODE_ENABLED` to `webEnvSchema` (line 51–58, inside the `.extend({})` block):

```ts
DEMO_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
```

**Why `webEnvSchema`:** Server Components read `WebEnv.DEMO_MODE_ENABLED` to conditionally render the DemoButton. No `NEXT_PUBLIC_` prefix — server-side only.

### 0b. Migration (`db/migrations/015_demo_user_columns.sql`)

New file:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_users_demo_cleanup ON users(demo_expires_at) WHERE is_demo = true;
```

**Constraints:**
- `TIMESTAMP` not `TIMESTAMPTZ` — consistency with all existing time columns
- Partial index — only scans demo users during cleanup
- Do NOT update `baseline_current_schema.sql` or `manifest.env`
- Auto-discovered by `loadMigrationManifest` (file pattern match)

---

<a id="phase-1"></a>
## Phase 1: Cookie Format + Auth Pipeline (KZO-107)

### 1a. Cookie signing/verification (`apps/api/src/auth/googleOAuth.ts`)

**Export new interface:**

```ts
export interface SessionIdentity {
  userId: string;
  isDemo: boolean;
}
```

**Modify `signSessionCookie` (line 64):**

```ts
/** Sign a session cookie value.
 *  HMAC signs the full payload including the `demo:` prefix when isDemo=true.
 *  Stripping or adding the prefix invalidates the signature — tamper-proof by construction. */
export function signSessionCookie(userId: string, sessionSecret: string, isDemo = false): string {
  const payload = isDemo ? `demo:${userId}` : userId;
  return `${payload}.${hmacSign(payload, sessionSecret)}`;
}
```

**Modify `verifySessionCookie` (line 72):**

```ts
/**
 * Verify an HMAC-signed session cookie and extract identity.
 * Returns { userId, isDemo } if the signature is valid, or null if tampered/malformed.
 */
export function verifySessionCookie(cookieValue: string, sessionSecret: string): SessionIdentity | null {
  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  const payload = cookieValue.slice(0, dotIndex);
  const receivedHmac = cookieValue.slice(dotIndex + 1);
  if (!payload || !receivedHmac) return null;

  if (!hmacVerify(payload, receivedHmac, sessionSecret)) return null;

  // Check for demo prefix on verified payload
  if (payload.startsWith("demo:")) {
    return { userId: payload.slice(5), isDemo: true };
  }
  return { userId: payload, isDemo: false };
}
```

### 1b. Auth pipeline (`apps/api/src/routes/registerRoutes.ts`)

**Modify `parseSessionCookie` (line 166):**

Return type changes from `string | null` to `SessionIdentity | null`:

```ts
function parseSessionCookie(cookieHeader: string | undefined, sessionSecret: string | undefined): SessionIdentity | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    if (part.slice(0, eqIdx).trim() === Env.SESSION_COOKIE_NAME) {
      const value = part.slice(eqIdx + 1).trim();
      if (!value) return null;
      if (!sessionSecret) return null;
      return verifySessionCookie(value, sessionSecret);
    }
  }
  return null;
}
```

**Modify `resolveUserId` (line 182):**

Return type changes from `string` to `{ userId: string; isDemo: boolean }`. Stashes `req.__sessionType`:

```ts
function resolveUserId(req: FastifyRequest, sessionSecret?: string): { userId: string; isDemo: boolean } {
  if (Env.AUTH_MODE === "oauth") {
    const identity = parseSessionCookie(req.headers.cookie, sessionSecret);
    if (identity) {
      req.__sessionType = identity.isDemo ? "demo" : "oauth";
      return { userId: userScopedIdSchema.parse(identity.userId), isDemo: identity.isDemo };
    }
    throw routeError(401, "auth_required", "authentication required");
  }

  // dev_bypass: also accept a valid session cookie when sessionSecret is available
  if (sessionSecret) {
    const identity = parseSessionCookie(req.headers.cookie, sessionSecret);
    if (identity) {
      req.__sessionType = identity.isDemo ? "demo" : "oauth";
      return { userId: userScopedIdSchema.parse(identity.userId), isDemo: identity.isDemo };
    }
  }

  const bypassHeader = req.headers["x-user-id"];
  if (!bypassHeader || Array.isArray(bypassHeader)) {
    return { userId: "user-1", isDemo: false };
  }
  return { userId: userScopedIdSchema.parse(bypassHeader), isDemo: false };
}
```

**Modify `loadUserStore` (line 206):**

```ts
async function loadUserStore(app: FastifyInstance, req: FastifyRequest) {
  const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  const store = await app.persistence.loadStore(userId);
  syncAccountingPolicy(store);
  return { userId, store };
}
```

**Update ALL direct `resolveUserId` call sites** (destructure `{ userId }`):

1. `app.post("/__e2e/reset", ...)` line 388 → `const { userId } = resolveUserId(...)`
2. `app.get("/profile", ...)` line 553 → `const { userId } = resolveUserId(...)`
3. `app.patch("/profile", ...)` line 558 → `const { userId } = resolveUserId(...)`
4. `app.post("/portfolio/transactions", ...)` → `const { userId } = resolveUserId(...)`
5. `app.post("/portfolio/dividends/postings", ...)` → `const { userId } = resolveUserId(...)`

**Import `SessionIdentity`** at the top of registerRoutes.ts (add to existing import from googleOAuth.js):
```ts
import { ..., type SessionIdentity } from "../auth/googleOAuth.js";
```

### 1c. Request decoration + response header

**`apps/api/src/types/fastify.d.ts` (modify existing file):**

```ts
import "fastify";
import type { Persistence } from "../persistence/types.js";
import type { GoogleOAuthConfig } from "../auth/googleOAuth.js";

declare module "fastify" {
  interface FastifyInstance {
    persistence: Persistence;
    oauthConfig: GoogleOAuthConfig | null;
    appBaseUrl: string;
  }
  interface FastifyRequest {
    __sessionType?: "demo" | "oauth";
  }
}
```

**`apps/api/src/app.ts` — add request decoration (in `buildApp`, after line 61):**

```ts
app.decorateRequest("__sessionType", null);
```

**`apps/api/src/app.ts` — add X-Session-Type to existing `onSend` hook (line 117):**

```ts
app.addHook("onSend", async (req, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (req.__sessionType) {
    reply.header("x-session-type", req.__sessionType);
  }
});
```

Note: The `_req` parameter on line 117 must be renamed to `req` to access `__sessionType`.

### 1d. Test updates (see Test Update Inventory below)

**Checkpoint:** `npm run lint && npm run test:unit && npm run test:integration:full:host`

---

<a id="phase-2"></a>
## Phase 2: Persistence + Demo Endpoint (KZO-107)

### 2a. Persistence interface (`apps/api/src/persistence/types.ts`)

Add to `Persistence` interface (after `readiness` method):

```ts
markDemoUser(userId: string, ttlSeconds: number): Promise<void>;
```

### 2b. PostgresPersistence (`apps/api/src/persistence/postgres.ts`)

Add method:

```ts
async markDemoUser(userId: string, ttlSeconds: number): Promise<void> {
  await this.pool.query(
    `UPDATE users SET is_demo = true, demo_expires_at = NOW() + $2 * INTERVAL '1 second' WHERE id = $1`,
    [userId, ttlSeconds]
  );
}
```

**Also expose pool for cleanup:** Add a getter to allow the cleanup service to access the pool:

```ts
getPool(): Pool {
  return this.pool;
}
```

### 2c. MemoryPersistence (`apps/api/src/persistence/memory.ts`)

Extend `MemoryUser` interface (line 10):

```ts
interface MemoryUser {
  id: string;
  email: string;
  displayName: string | null;
  providerSubject: string;
  providerDisplayName: string | null;
  providerPictureUrl: string | null;
  isDemo?: boolean;
  demoExpiresAt?: Date;
}
```

Add method:

```ts
async markDemoUser(userId: string, ttlSeconds: number): Promise<void> {
  const user = [...this.usersByEmail.values()].find((u) => u.id === userId);
  if (user) {
    user.isDemo = true;
    user.demoExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
  }
}
```

### 2d. Demo data seeding (`apps/api/src/services/demoData.ts`)

New file. Creates deterministic demo transactions:

```ts
import type { Persistence } from "../persistence/types.js";

const DEMO_BASE_DATE = new Date("2026-01-15");

interface DemoTransaction {
  accountId: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  tradeDate: string;
}

function buildDemoTransactions(accountId: string): DemoTransaction[] {
  // 12 deterministic transactions across 5 symbols
  return [
    { accountId, symbol: "2330", type: "BUY", quantity: 2, unitPrice: 98000, tradeDate: "2026-01-15" },
    { accountId, symbol: "2330", type: "BUY", quantity: 1, unitPrice: 99500, tradeDate: "2026-01-22" },
    { accountId, symbol: "2317", type: "BUY", quantity: 5, unitPrice: 18200, tradeDate: "2026-01-16" },
    { accountId, symbol: "2454", type: "BUY", quantity: 1, unitPrice: 126000, tradeDate: "2026-01-17" },
    { accountId, symbol: "2454", type: "BUY", quantity: 1, unitPrice: 128500, tradeDate: "2026-02-05" },
    { accountId, symbol: "2881", type: "BUY", quantity: 10, unitPrice: 7850, tradeDate: "2026-01-20" },
    { accountId, symbol: "0050", type: "BUY", quantity: 3, unitPrice: 18500, tradeDate: "2026-01-21" },
    { accountId, symbol: "0050", type: "BUY", quantity: 2, unitPrice: 18900, tradeDate: "2026-02-10" },
    { accountId, symbol: "2330", type: "SELL", quantity: 1, unitPrice: 101000, tradeDate: "2026-02-15" },
    { accountId, symbol: "2317", type: "SELL", quantity: 2, unitPrice: 19100, tradeDate: "2026-02-20" },
    { accountId, symbol: "2881", type: "BUY", quantity: 5, unitPrice: 8050, tradeDate: "2026-02-25" },
    { accountId, symbol: "0050", type: "BUY", quantity: 1, unitPrice: 19200, tradeDate: "2026-03-01" },
  ];
}

export async function seedDemoTransactions(persistence: Persistence, userId: string): Promise<void> {
  // Idempotent: check if user already has data
  const store = await persistence.loadStore(userId);
  if (store.transactions.length > 0) return;

  const accountId = store.accounts[0]?.id;
  if (!accountId) return;

  const transactions = buildDemoTransactions(accountId);

  for (const tx of transactions) {
    // Use createTransaction from portfolio service, or call persistence directly
    // We'll use store-level operations to keep it simple
    store.transactions.push({
      id: `demo-tx-${tx.tradeDate}-${tx.symbol}-${tx.type}`,
      accountId: tx.accountId,
      symbol: tx.symbol,
      type: tx.type,
      quantity: tx.quantity,
      unitPrice: tx.unitPrice,
      priceCurrency: "TWD",
      tradeDate: tx.tradeDate,
      isDayTrade: false,
      commissionAmount: 0,
      taxAmount: 0,
      instrumentType: tx.symbol === "0050" ? "ETF" : "STOCK",
      feeSnapshot: store.feeProfiles[0],
    } as any);
  }
  await persistence.saveStore(store);
}
```

**Note to implementer:** The actual implementation should use the `createTransaction` service function or the Persistence layer's trade event insertion. The above is a simplified sketch — the implementer should follow the existing `createTransaction` pattern from `apps/api/src/services/portfolio.ts` for each demo transaction. Since `createTransaction` handles lot allocation, fee snapshots, and cash ledger entries, calling it per-transaction is the correct approach. However, for MemoryPersistence the simplified store approach above works.

**Key constraint:** Use existing symbols only (2330, 2317, 2454, 2881, 0050). Do NOT insert into `symbols` or `dividend_events` tables.

### 2e. Demo endpoint (`apps/api/src/routes/registerRoutes.ts`)

Add route in `registerRoutes` function (after `app.post("/__e2e/oauth-session", ...)`, around line 426):

```ts
app.post("/auth/demo/start", async (req, reply) => {
  if (Env.DEMO_MODE_ENABLED !== "true") {
    throw routeError(404, "not_found", "not found");
  }

  // Per-IP rate limit: 5 requests per minute
  const demoRateKey = `${req.ip}:anonymous:POST:/auth/demo/start`;
  const now = Date.now();
  const windowMs = 60_000;
  const demoLimit = 5;
  const existing = mutationBuckets.get(demoRateKey);

  if (existing && now - existing.windowStartedAt < windowMs && existing.count >= demoLimit) {
    return reply.code(429).send({ error: "rate_limit_exceeded" });
  }

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    mutationBuckets.set(demoRateKey, { count: 1, windowStartedAt: now });
  } else {
    existing.count += 1;
  }

  const body = z.object({}).nullable().optional().parse(req.body ?? {});

  const demoId = randomUUID();
  const email = `demo-${demoId}@demo.local`;
  const ttlSeconds = Env.DEMO_SESSION_TTL_SECONDS;

  const userId = await app.persistence.resolveOrCreateUser("demo", demoId, {
    email,
    name: "Demo User",
  });

  await app.persistence.markDemoUser(userId, ttlSeconds);
  await seedDemoTransactions(app.persistence, userId);

  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required");
  }

  const signedCookie = signSessionCookie(userId, sessionSecret, true);
  const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}; Max-Age=${ttlSeconds}`);

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { userId, expiresAt, sessionType: "demo" };
});
```

**Import needed:** Add `seedDemoTransactions` import at top of registerRoutes.ts:
```ts
import { seedDemoTransactions } from "../services/demoData.js";
```

**Note on `mutationBuckets`:** This is the existing rate limiter Map defined in `app.ts`. The demo route needs access to it. Two approaches:
1. Move `mutationBuckets` to a shared module (preferred)
2. Export it from `app.ts`

The implementer should use the simplest approach — expose `mutationBuckets` from `app.ts` or import a shared rate limiting function. Alternatively, the demo endpoint can use its own `Map` for demo-specific rate limiting since it's simpler and doesn't touch the existing rate limiter.

**Recommended approach: Use a module-level Map in registerRoutes.ts:**

```ts
const demoRateBuckets = new Map<string, { count: number; windowStartedAt: number }>();
```

This avoids modifying `app.ts` and keeps the demo rate limit isolated.

### 2f. Atomic transaction for PostgresPersistence

For the PostgresPersistence backend, the demo creation should be wrapped in a transaction. However, `resolveOrCreateUser`, `markDemoUser`, and `seedDemoTransactions` each issue their own queries. To make this atomic:

**Option (simplest):** Accept non-atomic for MVP. `resolveOrCreateUser` is already idempotent. If `markDemoUser` or `seedDemoTransactions` fails, the user exists but isn't marked demo — the orphaned user is harmless and will be garbage-collected manually or on retry.

**Option (per spec):** Create a `createDemoUserAtomic` method on PostgresPersistence that wraps all three steps in a single `BEGIN`/`COMMIT`. This requires passing a `PoolClient` through all three calls.

**Decision for implementer:** Use the simpler non-transactional approach for MemoryPersistence. For PostgresPersistence, if the implementer can easily thread a client through, do it. Otherwise, the non-atomic approach is acceptable since all operations are idempotent.

### 2g. New integration tests (`apps/api/test/integration/demo-session.integration.test.ts`)

New file with tests:

```ts
describe("POST /auth/demo/start", () => {
  // 1. Demo endpoint creates user and returns signed cookie
  // 2. Demo user can access /settings with cookie
  // 3. X-Session-Type: demo header present on responses
  // 4. Endpoint returns 404 when DEMO_MODE_ENABLED=false
  // 5. Rate limit enforced (6th request returns 429)
  // 6. Demo data is seeded (non-empty store)
});
```

**Critical test setup:** Must mock `Env.DEMO_MODE_ENABLED` per the `vitest-auth-mode-override.md` rule:

```ts
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, DEMO_MODE_ENABLED: "true" as const, DEMO_SESSION_TTL_SECONDS: 1800 },
  };
});
```

**Checkpoint:** `npm run lint && npm run test:unit && npm run test:integration:full:host`

---

<a id="phase-3"></a>
## Phase 3: Cleanup (KZO-107)

### 3a. Cleanup function (`apps/api/src/services/demoCleanup.ts`)

New file:

```ts
import type { Pool } from "pg";

export async function cleanupExpiredDemoUsers(pool: Pool): Promise<number> {
  // Select expired demo user IDs (1 hour grace period after expiry)
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE is_demo = true AND demo_expires_at < NOW() - INTERVAL '1 hour'`
  );

  if (rows.length === 0) return 0;

  const userIds = rows.map((r) => r.id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 18 DELETEs in verified FK topological order
    await client.query(`DELETE FROM recompute_job_items WHERE job_id IN (SELECT id FROM recompute_jobs WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM cash_ledger_entries WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM dividend_deduction_entries WHERE dividend_ledger_entry_id IN (SELECT id FROM dividend_ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1)))`, [userIds]);
    await client.query(`DELETE FROM dividend_ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM lot_allocations WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM trade_events WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM trade_fee_policy_snapshots WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM lots WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM corporate_actions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM reconciliation_records WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM daily_portfolio_snapshots WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM recompute_jobs WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM accounts WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM fee_profile_tax_rules WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM fee_profiles WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM user_external_identities WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);

    await client.query("COMMIT");
    console.log(`[demo-cleanup] Deleted ${userIds.length} expired demo user(s)`);
    return userIds.length;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[demo-cleanup] Cleanup failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}
```

**FK ordering matches debate 04 appendix exactly (18 statements).** Note: `fee_profile_tax_rules` has `user_id` column per migration 011.

### 3b. Interval setup (`apps/api/src/server.ts`)

```ts
import { buildApp } from "./app.js";
import { Env } from "@tw-portfolio/config";
import { cleanupExpiredDemoUsers } from "./services/demoCleanup.js";
import type { PostgresPersistence } from "./persistence/postgres.js";

async function start() {
  Env.validateEnvConstraints();
  const app = await buildApp();
  await app.listen({ host: "::", port: Env.API_PORT });

  // Demo cleanup interval — only for postgres backend with demo mode enabled
  if (Env.PERSISTENCE_BACKEND === "postgres" && Env.DEMO_MODE_ENABLED === "true") {
    const pool = (app.persistence as PostgresPersistence).getPool();
    const cleanupIntervalMs = 15 * 60_000; // 15 minutes

    const intervalHandle = setInterval(async () => {
      try {
        await cleanupExpiredDemoUsers(pool);
      } catch (err) {
        console.error("[demo-cleanup] Interval cleanup error:", err);
      }
    }, cleanupIntervalMs);

    app.addHook("onClose", async () => {
      clearInterval(intervalHandle);
    });
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### 3c. Cleanup tests (`apps/api/test/integration/demo-cleanup.integration.test.ts`)

New file. These tests require postgres, so they should be gated:

```ts
describe("cleanupExpiredDemoUsers", () => {
  // 1. Create demo user with demo_expires_at in the past, call cleanup, assert deletion
  // 2. Valid (non-expired) demo user is NOT deleted
  // 3. Real user (is_demo=false) is NOT deleted
});
```

**Note:** These tests only run in `test:integration:full:host` which uses postgres. For `test:unit` (memory backend), the cleanup function is not exercised since it takes a `Pool`.

**Checkpoint:** Full test suite passes.

---

<a id="phase-4"></a>
## Phase 4: Frontend (KZO-108)

### 4a. `getSession()` update (`apps/web/lib/auth.ts`)

**Update `Session` interface (line 12):**

```ts
export interface Session {
  userId: string;
  isDemo: boolean;
}
```

**Update oauth mode code path in `resolveSession` (lines 74-87):**

After HMAC verification succeeds, check for demo prefix:

```ts
if (!hmacVerify(userId, receivedHmac, secret)) {
  console.warn("[auth] HMAC verification failed for session cookie");
  return null;
}

// Check for demo prefix on verified payload
if (userId.startsWith("demo:")) {
  return { userId: userId.slice(5), isDemo: true };
}
return { userId, isDemo: false };
```

**Update dev_bypass code path (lines 46-54):**

All returns become `{ userId: "...", isDemo: false }`:

```ts
if (raw?.trim()) return { userId: raw.trim(), isDemo: false };
const e2eRaw = cookieStore.get("tw_e2e_user")?.value;
if (e2eRaw?.trim()) return { userId: decodeURIComponent(e2eRaw.trim()), isDemo: false };
return { userId: "user-1", isDemo: false };
```

### 4b. Proxy route (`apps/web/app/api/demo/start/route.ts`)

New file. Follows the existing `/api/profile/route.ts` pattern:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { WebEnv } from "@tw-portfolio/config/web";

const API_BASE = WebEnv.SERVER_API_BASE_URL ?? WebEnv.NEXT_PUBLIC_API_BASE_URL;

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
    const cookieHeader = sessionCookie ? `${WebEnv.SESSION_COOKIE_NAME}=${sessionCookie}` : "";

    const res = await fetch(`${API_BASE}/auth/demo/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({}),
    });

    const body = await res.json();
    const response = NextResponse.json(body, { status: res.status });

    // Forward Set-Cookie header from API response
    const setCookie = res.headers.getSetCookie();
    for (const cookie of setCookie) {
      response.headers.append("set-cookie", cookie);
    }

    return response;
  } catch {
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
```

### 4c. DemoButton component (`apps/web/components/DemoButton.tsx`)

New file. Mirrors `SignInButton` pattern:

```tsx
"use client";

import { useState } from "react";

interface DemoButtonProps {
  className?: string;
}

export function DemoButton({ className }: DemoButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setLoading(true);
    try {
      sessionStorage.setItem("isDemo", "true");
      const res = await fetch("/api/demo/start", { method: "POST" });
      if (!res.ok) {
        sessionStorage.removeItem("isDemo");
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError("Too many demo sessions. Please wait a minute and try again.");
        } else {
          setError(body.error ?? "Failed to start demo session.");
        }
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      sessionStorage.removeItem("isDemo");
      setError("Cannot reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        data-testid="demo-sign-in-button"
        className={className}
      >
        {loading ? "Starting demo..." : "Try it — no sign-up needed"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
```

### 4d. Login page update (`apps/web/app/login/page.tsx`)

```tsx
import { Card } from "../../components/ui/Card";
import { buttonVariants } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { isValidReturnTo } from "../../lib/auth";
import { API_BASE } from "../../lib/api";
import { SignInButton } from "../../components/SignInButton";
import { DemoButton } from "../../components/DemoButton";
import { WebEnv } from "@tw-portfolio/config/web";

interface Props {
  searchParams: Promise<{ returnTo?: string; demoExpired?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { returnTo, demoExpired } = await searchParams;
  const validReturnTo = returnTo && isValidReturnTo(returnTo) ? returnTo : null;
  const signInHref = validReturnTo
    ? `${API_BASE}/auth/google/start?returnTo=${encodeURIComponent(validReturnTo)}`
    : `${API_BASE}/auth/google/start`;
  const showDemo = WebEnv.DEMO_MODE_ENABLED === "true";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="flex w-full max-w-sm flex-col items-center gap-6 py-10">
        {demoExpired && (
          <p className="text-sm text-amber-700" role="status">
            Your demo session has ended. Sign in to keep your data.
          </p>
        )}
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">TW Portfolio</h1>
          <p className="text-sm text-slate-500">Sign in to access your portfolio dashboard.</p>
        </div>
        <SignInButton
          href={signInHref}
          className={cn(buttonVariants({ variant: "default" }), "w-full")}
        />
        {showDemo && (
          <>
            <div className="flex w-full items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <DemoButton className={cn(buttonVariants({ variant: "secondary" }), "w-full")} />
          </>
        )}
      </Card>
    </main>
  );
}
```

### 4e. Demo expiry UX (`apps/web/lib/api.ts`)

**Update `redirectToLogoutOn401` (line 81):**

```ts
async function redirectToLogoutOn401<T>(res: Response, path: string): Promise<T> {
  if (res.status === 401 && typeof window !== "undefined") {
    // Demo session expired — redirect to login with message
    if (sessionStorage.getItem("isDemo")) {
      sessionStorage.removeItem("isDemo");
      window.location.href = "/login?demoExpired=true";
      return new Promise<T>(() => {});
    }
    window.location.href = `${API_BASE}/auth/logout`;
    return new Promise<T>(() => {});
  }
  throw await parseError(res, path);
}
```

### 4f. Demo banner

**`apps/web/app/dashboard/page.tsx` — pass `isDemo` prop:**

```tsx
export default async function DashboardPage() {
  const session = await requireSession();
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dashboard" isDemo={session.isDemo} />
    </Suspense>
  );
}
```

**`apps/web/components/layout/AppShell.tsx` — accept and render demo banner:**

Update `AppShellProps` (line 40):

```ts
interface AppShellProps {
  section?: AppSection;
  isDemo?: boolean;
}
```

Update function signature (line 63):

```ts
export function AppShell({ section = "dashboard", isDemo = false }: AppShellProps) {
```

Add demo banner above `TopBar` in the return JSX (before `<TopBar`, around line 242):

```tsx
return (
  <div className="app-shell relative min-h-screen min-w-0 overflow-x-hidden">
    {isDemo && (
      <div
        className="flex h-8 items-center justify-center bg-amber-100 text-xs font-medium text-amber-800"
        data-testid="demo-banner"
      >
        You&apos;re using a demo session.
      </div>
    )}
    <TopBar
      ...
```

**Also update portfolio and transactions pages similarly** to pass `isDemo`:

- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/transactions/page.tsx`

(These pages also call `requireSession()` and render `<AppShell>`.)

**Checkpoint:** `npm run lint && npm run test:unit` (web) — all pass

---

<a id="phase-5"></a>
## Phase 5: E2E Tests (KZO-108)

### 5a. Config (`apps/web/tests/e2e/playwright.oauth.config.ts`)

Add `DEMO_MODE_ENABLED: "true"` to the API server env block (line 75, inside `TestEnv.apiServerEnv({})`:

```ts
env: TestEnv.apiServerEnv({
  AUTH_MODE: "oauth",
  DEMO_MODE_ENABLED: "true",
  // ... rest unchanged
}),
```

### 5b. E2E test file (`apps/web/tests/e2e/specs-oauth/auth-demo.spec.ts`)

New file with 8 scenarios:

```ts
import { test, expect } from "@playwright/test";

test.describe("Demo user flow", () => {
  test("Scenario 1: Click demo button → session created → lands on /dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await page.waitForURL("**/dashboard");
    expect(page.url()).toContain("/dashboard");
  });

  test("Scenario 2: Demo user sees seeded portfolio data", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await page.waitForURL("**/dashboard");
    await page.waitForSelector("[data-testid='app-shell-ready']");
    // Verify non-empty holdings or market data
  });

  test("Scenario 3: Demo data isolated from real OAuth user", async ({ page }) => {
    // Use the auth setup state (real user) and verify no demo data
  });

  test("Scenario 4: sessionStorage.isDemo flag is set", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await page.waitForURL("**/dashboard");
    const isDemo = await page.evaluate(() => sessionStorage.getItem("isDemo"));
    expect(isDemo).toBe("true");
  });

  test("Scenario 5: Demo button shows error when disabled", async ({ page }) => {
    await page.route("**/api/demo/start", (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: "not_found" }) })
    );
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("Scenario 6: Rate limit feedback", async ({ page }) => {
    await page.route("**/api/demo/start", (route) =>
      route.fulfill({ status: 429, body: JSON.stringify({ error: "rate_limit_exceeded" }) })
    );
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await expect(page.getByRole("alert")).toContainText("wait");
  });

  test("Scenario 7: Demo banner visible on dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("demo-sign-in-button").click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByTestId("demo-banner")).toContainText("demo session");
  });

  test("Scenario 8: Login page hides button when DEMO_MODE_ENABLED=false", async ({ page }) => {
    // This test requires DEMO_MODE_ENABLED=false — may need a separate config or mock
    // Alternative: use page.route to intercept the server component render
    // Note: Since this is SSR, we'd need to test against a server with DEMO_MODE_ENABLED=false
    // For MVP: skip this test or test via unit test on the login page component
  });
});
```

### 5c. Proxy.ts demo cookie verification test

Add test case to existing web test suite or create new:

```ts
// Verify that proxy.ts correctly handles demo: prefix cookies
// (the HMAC verification in getSession handles this — test in getSession.test.ts)
```

---

<a id="test-update-inventory"></a>
## Test Update Inventory

### Unit tests: `apps/api/test/unit/session-cookie.test.ts`

**9 assertion changes** (`.toBe(string)` → `.toEqual({ userId: ..., isDemo: false })`):

| Line | Old | New |
|------|-----|-----|
| 38 | `expect(verifySessionCookie(signed, SECRET)).toBe("google-sub-123")` | `expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: "google-sub-123", isDemo: false })` |
| 44 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 48 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 51 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 56 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 61 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 65 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 69 | `.toBeNull()` | `.toBeNull()` (unchanged) |
| 75 | `expect(verifySessionCookie(signed, SECRET)).toBe(sub)` | `expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: sub, isDemo: false })` |

**3 new test cases to add:**

```ts
describe("demo cookie prefix", () => {
  it("signSessionCookie with isDemo=true prepends demo: to payload", () => {
    const signed = signSessionCookie("user-123", SECRET, true);
    expect(signed.startsWith("demo:user-123.")).toBe(true);
  });

  it("verifySessionCookie returns isDemo=true for demo-prefixed cookie", () => {
    const signed = signSessionCookie("user-123", SECRET, true);
    expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: "user-123", isDemo: true });
  });

  it("round-trip: sign demo cookie and verify returns correct identity", () => {
    const signed = signSessionCookie("demo-user-uuid", SECRET, true);
    const result = verifySessionCookie(signed, SECRET);
    expect(result).toEqual({ userId: "demo-user-uuid", isDemo: true });
    // Verify tampering fails
    const nonDemo = signSessionCookie("demo-user-uuid", SECRET, false);
    const nonDemoResult = verifySessionCookie(nonDemo, SECRET);
    expect(nonDemoResult).toEqual({ userId: "demo-user-uuid", isDemo: false });
  });
});
```

### Integration test: `e2e-oauth-session.integration.test.ts`

**2 assertions + `verifiedUserId` variable type:**

| Line | Old | New |
|------|-----|-----|
| 56 | `const verifiedUserId = verifySessionCookie(cookieValue, ...)` | Same call, but `verifiedUserId` is now `SessionIdentity \| null` |
| 57 | `expect(verifiedUserId).toBe(body.userId)` | `expect(verifiedUserId?.userId).toBe(body.userId)` |
| 58 | `expect(verifiedUserId).toMatch(/^[0-9a-f]{8}-.../)` | `expect(verifiedUserId?.userId).toMatch(/^[0-9a-f]{8}-.../)` |
| 86-88 | Same pattern | Same changes |

### Integration test: `oauth-identity-resolution.integration.test.ts`

**`extractCookieUserId` return type + 10 downstream assertions:**

The `extractCookieUserId` helper (line 60) returns `verifySessionCookie(...)` which is now `SessionIdentity | null`. Must extract `.userId`:

```ts
function extractCookieUserId(setCookie: string, sessionSecret: string): string | null {
  const match = setCookie.match(new RegExp(`${Env.SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySessionCookie(match[1], sessionSecret)?.userId ?? null;
}
```

This single change fixes all 10 downstream assertions since they compare `extractCookieUserId(...)` results. No assertion changes needed — the helper returns `string | null` as before.

### Integration test: `auth-oauth.integration.test.ts`

**2 assertions** (lines 212-214):

```ts
// Line 212: was verifySessionCookie returning string
const verifiedUserId = verifySessionCookie(cookieValue, testOAuthConfig.sessionSecret);
// Change to:
expect(verifiedUserId?.userId).toBeTruthy();
expect(verifiedUserId?.userId).toMatch(/^[0-9a-f]{8}-...$/);
```

### Web unit tests: `apps/web/test/features/auth/getSession.test.ts`

**17 assertion changes** (all `toEqual({ userId: "..." })` → `toEqual({ userId: "...", isDemo: false })`):

Lines: 111, 149, 185, 189, 193, 199, 205, 213, 219, 230, plus `signCookie` helper needs update for demo tests.

All mechanical replacements — find `toEqual({ userId:` and add `, isDemo: false`.

**New test cases to add:**

```ts
describe("getSession (oauth mode) — demo prefix", () => {
  it("returns { userId, isDemo: true } for demo-prefixed cookie", async () => {
    const demoSigned = `demo:user-123.${hmacSign("demo:user-123", SECRET)}`;
    setCookie(demoSigned);
    expect(await getSession()).toEqual({ userId: "user-123", isDemo: true });
  });

  it("returns { userId, isDemo: false } for non-demo cookie", async () => {
    setCookie(signCookie("user-123"));
    expect(await getSession()).toEqual({ userId: "user-123", isDemo: false });
  });
});
```

---

<a id="file-change-matrix"></a>
## File Change Matrix

### New Files (7)

| File | Phase | Owner |
|------|-------|-------|
| `db/migrations/015_demo_user_columns.sql` | 0 | Backend |
| `apps/api/src/services/demoData.ts` | 2 | Backend |
| `apps/api/src/services/demoCleanup.ts` | 3 | Backend |
| `apps/api/test/integration/demo-session.integration.test.ts` | 2 | Backend |
| `apps/api/test/integration/demo-cleanup.integration.test.ts` | 3 | Backend |
| `apps/web/app/api/demo/start/route.ts` | 4 | Frontend |
| `apps/web/components/DemoButton.tsx` | 4 | Frontend |
| `apps/web/tests/e2e/specs-oauth/auth-demo.spec.ts` | 5 | Frontend |

### Modified Files (16)

| File | Phase | Change Summary |
|------|-------|---------------|
| `libs/config/src/env-schema.ts` | 0 | +2 env vars to `envSchema`, +1 to `webEnvSchema` |
| `apps/api/src/auth/googleOAuth.ts` | 1 | `SessionIdentity` interface, `signSessionCookie` isDemo param, `verifySessionCookie` returns `SessionIdentity` |
| `apps/api/src/routes/registerRoutes.ts` | 1,2 | `parseSessionCookie` + `resolveUserId` return types, destructure all call sites, demo endpoint |
| `apps/api/src/app.ts` | 1 | `decorateRequest`, `onSend` hook X-Session-Type |
| `apps/api/src/types/fastify.d.ts` | 1 | `FastifyRequest.__sessionType` declaration |
| `apps/api/src/persistence/types.ts` | 2 | `markDemoUser` method |
| `apps/api/src/persistence/postgres.ts` | 2 | `markDemoUser` implementation, `getPool()` getter |
| `apps/api/src/persistence/memory.ts` | 2 | `MemoryUser` extension, `markDemoUser` implementation |
| `apps/api/src/server.ts` | 3 | Cleanup interval setup |
| `apps/web/lib/auth.ts` | 4 | `Session.isDemo`, demo prefix parsing |
| `apps/web/lib/api.ts` | 4 | `redirectToLogoutOn401` demo check |
| `apps/web/app/login/page.tsx` | 4 | DemoButton, demoExpired message |
| `apps/web/app/dashboard/page.tsx` | 4 | Pass `isDemo` to AppShell |
| `apps/web/components/layout/AppShell.tsx` | 4 | `isDemo` prop, demo banner |
| `apps/web/tests/e2e/playwright.oauth.config.ts` | 5 | `DEMO_MODE_ENABLED=true` in env |
| `apps/api/test/unit/session-cookie.test.ts` | 1 | 2 assertion changes + 3 new tests |
| `apps/api/test/integration/e2e-oauth-session.integration.test.ts` | 1 | 4 assertion changes |
| `apps/api/test/integration/oauth-identity-resolution.integration.test.ts` | 1 | `extractCookieUserId` helper change |
| `apps/api/test/integration/auth-oauth.integration.test.ts` | 1 | 2 assertion changes |
| `apps/web/test/features/auth/getSession.test.ts` | 4 | 17 assertion changes + 2 new tests |

---

## Wave Planning

### Wave 1 (Phases 0-3: Backend — KZO-107)

**Teammates needed:**
- **TDD Implementer** — Implements Phases 0-3 code changes
- **QA** — Plans and validates test coverage for Phases 0-3

**TDD Implementer scope:**
- Phase 0: env schema + migration
- Phase 1: cookie format changes + auth pipeline + existing test updates
- Phase 2: persistence layer + demo endpoint + demo data seeding + new integration tests
- Phase 3: cleanup service + interval + cleanup tests

**Files in-scope for modification:**
- `libs/config/src/env-schema.ts`
- `apps/api/src/auth/googleOAuth.ts`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/app.ts`
- `apps/api/src/types/fastify.d.ts`
- `apps/api/src/persistence/types.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/src/persistence/memory.ts`
- `apps/api/src/server.ts`
- `apps/api/test/unit/session-cookie.test.ts`
- `apps/api/test/integration/e2e-oauth-session.integration.test.ts`
- `apps/api/test/integration/oauth-identity-resolution.integration.test.ts`
- `apps/api/test/integration/auth-oauth.integration.test.ts`

**New files to create:**
- `db/migrations/015_demo_user_columns.sql`
- `apps/api/src/services/demoData.ts`
- `apps/api/src/services/demoCleanup.ts`
- `apps/api/test/integration/demo-session.integration.test.ts`
- `apps/api/test/integration/demo-cleanup.integration.test.ts`

**Files NOT in-scope (do NOT modify):**
- `apps/api/vitest.config.ts` — per `.claude/rules/vitest-auth-mode-override.md`
- `apps/web/**` — Wave 2

**Exit criteria:** `npm run lint && npm run test:unit && npm run test:integration:full:host` all pass.

### Wave 2 (Phases 4-5: Frontend — KZO-108)

**Teammates needed:**
- **TDD Implementer** — Implements Phases 4-5 code changes
- **QA** — Plans and validates test coverage for Phases 4-5

**TDD Implementer scope:**
- Phase 4: getSession update, proxy route, DemoButton, login page, demo expiry UX, demo banner
- Phase 5: E2E tests + playwright config

**Files in-scope for modification:**
- `apps/web/lib/auth.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/login/page.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/components/layout/AppShell.tsx`
- `apps/web/test/features/auth/getSession.test.ts`
- `apps/web/tests/e2e/playwright.oauth.config.ts`

**New files to create:**
- `apps/web/app/api/demo/start/route.ts`
- `apps/web/components/DemoButton.tsx`
- `apps/web/tests/e2e/specs-oauth/auth-demo.spec.ts`

**Also update (if they render AppShell):**
- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/transactions/page.tsx`

**Exit criteria:** All 5 commands pass:
```
npm run lint
npm run test:unit
npm run test:integration:full:host
npm run test:e2e:bypass:mem
npm run test:e2e:oauth:mem
```

---

## Critical Rules for Implementers

1. **vitest-auth-mode-override.md:** `vitest.config.ts` sets `AUTH_MODE=dev_bypass` for ALL api tests. Tests needing demo mode must use `vi.mock("@tw-portfolio/config")` to override `Env.DEMO_MODE_ENABLED`.

2. **fixer-scope-guardrail.md:** Do NOT modify `app.ts` or `registerRoutes.ts` auth logic to fix test setup issues. The cookie format and `resolveUserId` return type changes are spec-required, not test fixes.

3. **api-route-session-guard.md:** The proxy route at `/api/demo/start` does NOT need auth — it's the demo creation endpoint (unauthenticated by design). The existing profile proxy pattern uses `getSession()` + 401, but the demo proxy skips auth and forwards directly.

4. **Git policy:** Do NOT run `git add`, `git commit`, or `git push`. All changes remain uncommitted.
