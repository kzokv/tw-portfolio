# Service Error Pattern

Always use `routeError(statusCode, code, message)` from `apps/api/src/lib/routeError.ts` when throwing in service files. Never use plain `throw new Error("...")`.

```ts
// ✅ Correct
throw routeError(404, "account_not_found", "Account not found");

// ❌ Wrong — produces 500 instead of the intended status code
throw new Error("Account not found");
```

Pick the correct HTTP status: 404 for missing resources, 400 for validation, 409 for conflicts.

**Why:** The Fastify error handler in `app.ts` checks `error.statusCode` to decide the response code. Plain `Error` objects have no `statusCode`, so they fall through `isKnownClientError()` and hit `reply.code(500)`. This caused real 500s in production for client errors.

**How to apply:** Any time you add or modify a throw in `apps/api/src/services/**`, import `routeError` from `../lib/routeError.js` and use it with the appropriate HTTP status code.

## Distinguishing per-client vs upstream-budget rate limits — 429 vs 503

When a route can be rate-limited from two structurally distinct sources, use different status codes so logs, alerts, and client retry semantics stay disambiguated:

- **`429 rate_limit_exceeded`** — per-client identity exhausted ("your IP is hammering us"). Existing example: `assertMarketDataPriceRateLimit(req.ip)` in `apps/api/src/lib/marketDataPriceRateLimit.ts:9`.
- **`503 provider_rate_limited` + `Retry-After: <seconds>` header** — upstream provider's shared budget exhausted (server-side condition affecting ALL clients regardless of identity). RFC 7231 §6.6.4 designates 503 + `Retry-After` for "temporary overload."

```ts
// Example: provider raises a typed RateLimitedError. Route catches it before send().
try {
  bars = await provider.fetchBars(ticker);
} catch (err) {
  if (err instanceof RateLimitedError) {
    const retryAfterSec = Math.max(1, Math.ceil(err.msUntilAvailable / 1000));
    reply.header("Retry-After", String(retryAfterSec));
    throw routeError(503, "provider_rate_limited", "market data provider rate limit exceeded");
  }
  throw err;
}
```

The two guards are sequential, not exclusive — a request that survives the per-IP 429 gate may still hit the upstream-budget 503 gate.

**Why:** Established in KZO-163 for `/market-data/price`. Returning 429 for both per-IP and provider-budget exhaustion would mask the distinction in client logs and alerting. Browsers and HTTP clients commonly auto-handle `Retry-After` on 503 (server overload), which is the desired UX. 429 is typically interpreted as per-client identity throttle.

**How to apply:** When introducing rate-limit branching to a new route or extending an existing one (KZO-164 FX, KZO-170 US, KZO-171 AU all share the same shared-budget pattern), distinguish per-client (429) from upstream provider/budget exhaustion (503 + Retry-After). Route logs and alerting should track these as separate signals.
