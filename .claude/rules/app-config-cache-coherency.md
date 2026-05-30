# App-Config Cache Coherency: Generation Counter + PATCH-Response Bypass

Two patterns that protect a TTL cache from stale reads when admin writes and concurrent reads race. Both arose from KZO-198 Codex P2 #3 — the original fire-and-forget `invalidate()` plus DTO-from-cache combination produced intermittently stale `PATCH /admin/settings` responses on rapid PATCH+GET sequences.

These pair with `.claude/rules/fastify-app-config-bootstrap.md` (which covers boot-time correctness) and apply to any per-process TTL cache that combines fire-and-forget invalidation with concurrent reads.

---

## 1. Cache generation counter for refresh-overwrite safety

When `invalidate()` is fire-and-forget AND a prior `refresh()` can be in flight, the older refresh can resolve AFTER `invalidate()` and clobber the freshly-loaded entry. Symptom: cache holds stale data intermittently after rapid PATCH+GET sequences.

Fix: monotonic `generation` counter on the cache state. `invalidate()` bumps it. `refresh()` captures the start-generation; if the generation has changed by the time the fetch completes, discard the result.

```ts
interface CacheState<T> {
  entry: T | null;
  generation: number;        // monotonic; bumped on invalidate
  pending: Promise<void> | null;
}

async function refresh(): Promise<void> {
  const startGen = _state.generation;
  const job = (async () => {
    const row = await persistence.fetch();
    if (_state.generation !== startGen) return;   // discard stale result
    _state.entry = row;
  })();
  _state.pending = job;
  await job;
}

function invalidate(): void {
  _state.entry = null;
  _state.generation += 1;
  void refresh();
}
```

Cheap (one int + one comparison per refresh), no locks needed. Generalizes to any per-process cache where invalidation can race with a refresh started by an earlier read.

## 2. PATCH response DTO — derive from post-write row, not from cache

PATCH handlers that wrap a write in a `loadDto()` post-read can race the cache: the write hits the DB, the cache is invalidated fire-and-forget, the DTO loader calls `getEffective*()` resolvers — which read the cold cache and return ENV-FALLBACK values for fields the user just wrote.

```ts
// ❌ Wrong — DTO reads via resolvers; cache is mid-refresh; response shows env-fallback
await app.persistence.setAppConfigPatch(patch);
invalidate();                              // fire-and-forget; cache may still be cold
return loadAppConfigDto(app);              // resolvers → cold cache → env-fallback values

// ✅ Correct — DTO derives from the row just written; cache invalidate is for SUBSEQUENT reads
await app.persistence.setAppConfigPatch(patch);
invalidate();                              // for everyone else's next read
const row = await app.persistence.getAppConfig();   // authoritative, post-write
return buildAppConfigDtoFromRow(row);      // effective values = row.X ?? Env.X inline
```

`buildXFromRow` does `row.field ?? Env.FIELD_FALLBACK` inline — no resolver indirection, no cache coupling for the response path. Cache invalidate stays fire-and-forget for everyone else.

**Two distinct read paths:**
- Source code → resolvers → cache (for non-PATCH consumers)
- PATCH response → freshly-fetched row, no cache (for the one caller who needs strict read-your-own-writes semantics)

---

## Why this is a single rule

#1 alone is insufficient: even with a generation-safe refresh, the PATCH handler can still build its response from a stale `entry` if the refresh hasn't completed by the time `getEffective*()` is called. #2 alone is insufficient: subsequent GETs from non-PATCH paths still see stale data when an in-flight refresh resolves after `invalidate()`. Apply both together for any cache that backs a PATCH response.

## Why

KZO-198 Codex P2 #3. Tests that PATCH `/admin/settings` and immediately GET the response to assert the new value were intermittently flaky — the response paired persisted raw values from the DB with env-fallback effective values from the cold-cache resolver path. The flake reproduced on macOS host but not on CI runners where network was faster than the cache refresh.

## How to apply

- Any new per-process TTL cache that backs a PATCH-style write endpoint.
- Pre-PR audit: in the PATCH handler, every call to `loadXDto(...)` after a write is suspect — it should read the row directly and derive the response without going through the cache.
- Pre-PR audit: any `invalidate()` that is fire-and-forget AND the cache supports concurrent `refresh()` calls — must include the generation-counter pattern.
- Pairs with `.claude/rules/fastify-app-config-bootstrap.md` (boot-time correctness; this rule covers runtime mutation correctness).
