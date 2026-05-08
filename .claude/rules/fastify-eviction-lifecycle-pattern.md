# Fastify Timer Eviction: Use a `registerXEviction(app)` Factory

Any route module that needs a periodic sweep (sliding-window rate bucket, cache expiry, in-memory TTL) must encapsulate the `setInterval + onClose` pair inside a dedicated `registerXEviction(app: FastifyInstance)` function exported from its own lib file. Never inline `setInterval` blocks inside `registerRoutes.ts`.

**Pattern:**

```ts
// apps/api/src/lib/myRateLimit.ts
import type { FastifyInstance } from "fastify";
import { sweepSlidingWindowBucket } from "./slidingWindowBucket.js";

const myBuckets = new Map<string, number[]>();
const WINDOW_MS = 60_000;

export function registerMyEviction(app: FastifyInstance): void {
  const timer = setInterval(
    () => sweepSlidingWindowBucket(myBuckets, WINDOW_MS),
    WINDOW_MS,
  );
  app.addHook("onClose", () => clearInterval(timer));
}
```

```ts
// apps/api/src/routes/registerRoutes.ts — call at top of registerRoutes()
import { registerMyEviction } from "../lib/myRateLimit.js";

export function registerRoutes(app: FastifyInstance, ...) {
  registerMyEviction(app);
  // ...routes
}
```

**Rules:**
1. The factory owns both `setInterval` AND the `onClose` cleanup — they are inseparable.
2. Call all `register*Eviction(app)` helpers **before** route handlers that populate the buckets.
3. The assert function signature should be `(ip: string)`, not `(req: FastifyRequest)` — read `req.ip` at the call site in the route handler. This keeps the limiter decoupled from Fastify and trivially unit-testable.
4. If the window/limit values come from `Env`, read them inside the registration helper (not at module load time) so test mocks take effect.

**Canonical reference:** `apps/api/src/lib/{inviteStatusRateLimit,anonymousShareRateLimit}.ts` (KZO-155).

**Why:** Inlining `setInterval` blocks in `registerRoutes.ts` hides cleanup logic and couples eviction lifecycle to the route file. The factory pattern keeps Fastify lifecycle coupling at the module edge. The `onClose` hook ensures graceful teardown in tests and server restarts — without it, leaked timers cause test hangs. Extracted in KZO-155 from two inline blocks that had grown unbounded in `registerRoutes.ts`.

**How to apply:** Any time a new sliding-window rate limiter, in-memory cache with TTL, or periodic sweep is added to the API. Also applies retroactively when reviewing `registerRoutes.ts` — any bare `setInterval` without a paired `onClose` is a bug waiting to surface in test teardown.

## Sweep parameter is admin-tunable; sweep cadence stays env-default

The `setInterval` interval (the second arg — the schedule) MUST stay at the env-default and MUST NOT be re-read per tick. But the **window value passed into the sweep callback** must be the live effective value, not the env-default captured at registration. Otherwise an admin-extended window prematurely drops in-flight entries — the bucket is deleted before the configured longer window expires, and subsequent requests aren't counted against the override.

```ts
// ❌ Wrong — sweeps using env window even when an admin override extends it
const timer = setInterval(
  () => sweepSlidingWindowBucket(buckets, Env.WINDOW_MS),  // captured at registration
  Env.WINDOW_MS,
);

// ✅ Correct — schedule fixed; sweep parameter live
const timer = setInterval(
  () => sweepSlidingWindowBucket(buckets, getEffectiveWindowMs()),  // live per-tick
  Env.WINDOW_MS,                                                    // cadence stays env
);
```

**Two-axis decoupling:** schedule = static (env, captured once at registration), sweep parameter = live (read via resolver inside the callback).

**Why:** KZO-198 Codex P2 #1. Admin extended `MARKET_DATA_PRICE_WINDOW_MS` from 60s (env default) to 600s via `app_config`. The sweep timer kept firing every 60s and deleted the bucket once the IP was idle for >60s. Subsequent requests started a fresh bucket — the longer override never enforced. Same pattern applied to search and invite-status limiters.

**How to apply:** Any sliding-window or TTL-sweep limiter where the window length is admin-tunable but the schedule is not. Pre-PR check: every `setInterval(() => sweep(buckets, X), Y)` site — `X` should be a live resolver call, not a captured env constant.
