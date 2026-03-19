---
name: ISE root-cause fixes (KZO dev-issue branch)
description: Five surgical fixes implemented to eliminate intermittent HTTP 500 errors on twp-dev-web
type: project
---

Five fixes were implemented on the `dev-issue` worktree to eliminate intermittent 500s:

1. **`loadStore()` parallelized** (`apps/api/src/persistence/postgres.ts`) — restructured ~15 sequential DB queries into 3 `Promise.all` batches (Batch 1: 10 independent queries, Batch 2: 7 ID-dependent queries, Batch 3: 1 dividend-deduction query). This was the primary ISE cause under DB latency/pool contention.

2. **CORS callback fixed** (`apps/api/src/app.ts:79`) — replaced `callback(new Error("Origin not allowed"), false)` with `callback(null, false)` so disallowed origins get a clean CORS rejection instead of a 500.

3. **`routeError` extracted to shared lib** (`apps/api/src/lib/routeError.ts`) — plain `throw new Error()` in service files bypassed the `statusCode` check in the error handler and fell through to 500. All three service files (`portfolio.ts`, `dividends.ts`, `recompute.ts`) and `registerRoutes.ts` now use the shared `routeError(statusCode, code, message)` factory.

4. **Root error boundary added** (`apps/web/app/error.tsx` + `apps/web/app/symbols/[symbol]/error.tsx`) — Next.js App Router had zero error boundaries; unhandled server render errors produced raw 500 pages.

5. **`symbols/[symbol]/page.tsx` fetch wrapped in try/catch** — `Promise.all([fetchDashboardSnapshot(), fetchTransactionHistory(...)])` was unwrapped; on failure the page now renders a graceful fallback with a back link.

**Why:** QA found ~33–50% transient 500 rate on `/dashboard/overview`, `/portfolio/transactions`, and related endpoints. Root cause was sequential DB query latency in `loadStore()` exceeding request timeout.

**How to apply:** If 500 rate spikes again, check `loadStore()` batch structure first. Any new service-layer throws must use `routeError()` from `lib/routeError.ts`, not plain `Error`.
