---
slug: kzo-150
source: scope-grill
created: 2026-04-19
tickets: [KZO-150]
required_reading: []
superseded_by: null
---

# Todo: KZO-150 — Rate-limit sliding-window bucket eviction

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Key context: both buckets live in `apps/api/src/routes/registerRoutes.ts`; the eviction sweep lives inside `registerRoutes` (not module-level) so it can use `app.addHook("onClose", ...)` for cleanup.

## Decisions (locked 2026-04-19)

- **Interval site**: inside `registerRoutes` (has `app` reference), not module-level
- **Shutdown cleanup**: `app.addHook("onClose", () => clearInterval(timer))` — one hook per interval
- **Two separate intervals**: `inviteStatusBuckets` at `INVITE_STATUS_WINDOW_MS` (60 000 ms); `anonymousShareRateBuckets` at `Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (default 300 000 ms)
- **Pure sweep function**: `sweepSlidingWindowBucket(bucket, windowMs, now = Date.now())` — generic, exported, called by both intervals; `now` param makes tests spy-free
- **Demo bucket excluded**: `demoRateBuckets` uses fixed-window design; self-evicts on hit; out of scope
- **Reset helpers unchanged**: `_resetInviteStatusBuckets()` and `_resetAnonymousShareRateBuckets()` remain separate; no `_resetAllRateBuckets()`; `_resetDemoRateBuckets()` untouched
- **Module extraction deferred**: both limiters stay in `registerRoutes.ts`; follow-up is KZO-155
- **`adminRoutes.ts` / `/__e2e/reset` handler**: zero changes

## Implementation Steps

- [x] Add `sweepSlidingWindowBucket` to `apps/api/src/routes/registerRoutes.ts`:
  ```ts
  export function sweepSlidingWindowBucket(
    bucket: Map<string, number[]>,
    windowMs: number,
    now = Date.now(),
  ): void {
    for (const [ip, timestamps] of bucket) {
      if (timestamps.every((ts) => now - ts >= windowMs)) {
        bucket.delete(ip);
      }
    }
  }
  ```
  Note: `[].every(fn)` is vacuously true — empty arrays would be evicted. Current write
  paths always push a timestamp before set, so empty arrays cannot exist; preserve this
  invariant in any future bucket writes.

- [x] Inside `registerRoutes`, after the bucket declarations (lines 372–379), register two
  eviction intervals and wire cleanup hooks:
  ```ts
  const inviteEvictionTimer = setInterval(
    () => sweepSlidingWindowBucket(inviteStatusBuckets, INVITE_STATUS_WINDOW_MS),
    INVITE_STATUS_WINDOW_MS,
  );
  app.addHook("onClose", async () => { clearInterval(inviteEvictionTimer); });

  const anonShareWindowMs = Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS;
  const anonEvictionTimer = setInterval(
    () => sweepSlidingWindowBucket(anonymousShareRateBuckets, anonShareWindowMs),
    anonShareWindowMs,
  );
  app.addHook("onClose", async () => { clearInterval(anonEvictionTimer); });
  ```

- [x] Create `apps/api/test/unit/rate-bucket-eviction.test.ts` with 5 cases (no spies,
  no `buildApp`, no fake timers — pass synthetic `now` directly):
  1. All timestamps stale → entry evicted
  2. Mix of stale + recent timestamps → entry retained
  3. All timestamps fresh → entry retained
  4. Multiple IPs: only stale IP evicted, fresh IP retained
  5. Empty map → no-op (no error, map still empty)

## Out of Scope

- `_resetAllRateBuckets()` consolidation
- Demo bucket eviction
- Module extraction (→ KZO-155)
- Env-configurability of `INVITE_STATUS_WINDOW_MS`
- Changes to `adminRoutes.ts` or `/__e2e/reset` handler

## References

- Linear: [KZO-150](https://linear.app/kzokv/issue/KZO-150)
- Follow-up extraction: [KZO-155](https://linear.app/kzokv/issue/KZO-155)
- Bucket declarations: `apps/api/src/routes/registerRoutes.ts:372,379`
- Existing sweep test pattern: `apps/api/test/unit/anonymous-share-rate-limiter.test.ts`
