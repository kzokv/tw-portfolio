# Fastify App-Config Bootstrap: onReady Hook + Eager Pre-Warm + Resolver Gates

Three patterns that must be applied together when introducing a TTL cache over a DB-backed config table that is read during `buildApp()`. Discovered together during KZO-198 (`app_config` Tier A — encryption + per-category resolvers). Skipping any one of them ships a silent regression.

---

## 1. Use `app.addHook("onReady", ...)`, not `app.ready(callback)`

`app.ready(callback)` **engages** Fastify's ready chain immediately when called. Any subsequent `addHook(...)` on the same instance throws `FST_ERR_INSTANCE_ALREADY_LISTENING`. The error surfaces inconsistently — longer init paths (Postgres backend) widen the window and make it reproducible; faster paths (memory backend) miss it entirely.

```ts
// ❌ Wrong — engages the ready chain; later addHook throws under Postgres
await app.persistence.init();
app.ready(() => {
  void refreshAppConfigCache().catch((err) => app.log.warn({ err }, "..."));
});
// later in buildApp():
app.addHook("onClose", async () => { ... });   // FST_ERR_INSTANCE_ALREADY_LISTENING

// ✅ Correct — onReady is a hook; later addHook calls register fine
await app.persistence.init();
app.addHook("onReady", async () => {
  try { await refreshAppConfigCache(); }
  catch (err) { app.log.warn({ err }, "app_config_cache_prewarm_failed"); }
});
```

`app.ready(callback)` is almost always wrong mid-`buildApp()`. Reserve it for the genuine "I am the LAST caller and nothing else will register hooks after this" case (typically `server.ts`, not `buildApp()`).

## 2. Eager pre-warm BEFORE downstream init that consumes the cache

`addHook("onReady", ...)` fires AFTER `buildApp()` returns. Any consumer **inside** `buildApp()` — pg-boss queue creation, provider registry build, anything reading `getEffective*()` resolvers — sees the cold cache and silently degrades to env-fallback.

The fix is a two-phase pre-warm: an **eager** `await refresh()` right after binding the cache to persistence, plus the `onReady` hook as a defensive idempotent re-warm.

```ts
app.persistence = createPersistence(...);
const { setAppConfigCachePersistence, refresh } =
  await import("./services/appConfig/cache.js");
setAppConfigCachePersistence(app.persistence);
await app.persistence.init();           // singleton row must exist for the SELECT
try { await refresh(); }                // <-- eager pre-warm; downstream init sees hot cache
catch (err) { app.log.warn({ err }, "app_config_cache_prewarm_failed"); }

// NOW safe to build registry, register pg-boss queues, etc.
app.marketDataRegistry = buildMarketDataRegistry(Env);

// onReady hook below is retained as defensive idempotent re-warm for late consumers.
app.addHook("onReady", async () => {
  try { await refresh(); }
  catch (err) { app.log.warn({ err }, "app_config_cache_prewarm_failed"); }
});
```

Generalizes to any TTL cache consumed during `buildApp()` / bootstrap.

## 3. Provider real-vs-mock gates must consult the cache resolver, not env-only

Registry-build patterns that gate on `env.X_TOKEN ? real : mock` drop the DB-resolver path entirely. Operators who store the API token in `app_config` (rather than env) get the mock provider — silently — until they redeploy with the env var set.

```ts
// ❌ Wrong — env-only gate; DB-stored token never takes effect
const finmindProvider = env.FINMIND_API_TOKEN
  ? new FinMindMarketDataProvider({ token: env.FINMIND_API_TOKEN, ... })
  : new MockFinMindMarketDataProvider();

// ✅ Correct — read effective via resolver; provider re-reads live per-fetch for rotation
const bootstrapToken = getEffectiveFinmindApiToken() ?? env.FINMIND_API_TOKEN;
const finmindProvider = bootstrapToken
  ? new FinMindMarketDataProvider({ token: bootstrapToken, ... })
  : new MockFinMindMarketDataProvider();
```

Eager pre-warm (#2) is a prerequisite — without it `getEffective*()` returns env-fallback at registry-build time and the gate behaves identically to the env-only form.

Alternative when eager pre-warm is not feasible: pass a `() => getEffectiveX()` callback into the real provider and **always** construct the real provider — defer the gate to first-fetch.

**Audit checklist when introducing a DB-backed config:** every `if (env.X)` site that mirrors a new resolver is a candidate for the resolver gate.

---

## Why this is a single rule

The three patterns are not independent — applying any one in isolation leaves the other two broken:

- Just #1 (onReady): cold cache during `buildApp()`; downstream consumers see env-fallback.
- Just #2 (eager pre-warm): the second `app.ready(callback)` regresses to FST_ERR_INSTANCE_ALREADY_LISTENING.
- Just #3 (resolver gates): with a cold cache the gates behave identically to env-only.

Apply all three together when introducing a TTL cache over DB-backed config consumed during boot.

## Why

KZO-198 — three Codex P2 findings (#1 Suite-5 hook ordering, #2 backfill worker queue options frozen with cold-cache values, #3 FinMind+Twelve Data registries silently picking mock providers when DB-only token rotation was used). All three landed in a single Backend Implementer task. The pattern recurs whenever a new DB-backed config column is added; promoting the cluster avoids a Phase-3 cycle on every future ticket.

## How to apply

- Any time a new TTL cache is introduced over a DB-backed config table consumed during `buildApp()`.
- Pre-PR audit: search for `app.ready(` in `apps/api/src/app.ts` — any bare `ready()` call (not `await app.ready()`) is suspect.
- Pre-PR audit: search for `if (Env\.[A-Z_]*_TOKEN\b|if (Env\.[A-Z_]*_API_KEY\b` in registry-build files — each match is a resolver-gate candidate.
- Pairs with `.claude/rules/fastify-eviction-lifecycle-pattern.md` (which covers the static `setInterval` cadence side; this rule covers the cache-consumer side).
