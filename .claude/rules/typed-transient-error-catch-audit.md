# Typed Transient-Error Catch Audit

When introducing a typed error class that signals "transient — caller should reschedule, retry, or back off" (e.g. `RateLimitedError`, `RetryableError`, `TransientFailure`), audit every existing `try/catch` the new error might pass through. Each such catch must either re-throw the typed error OR be explicit about swallowing it.

## Why this is easy to miss

Pre-existing catches were correct before. A graceful warn-and-continue catch around a fetch operation is the right pattern when the fetch can fail with normal transient errors that should NOT cancel the larger operation. The bug is silent: the new typed error (which IS supposed to cancel and reschedule) gets eaten by the existing catch, and the reschedule signal never reaches the outer handler.

TypeScript does not catch this. The catch parameter is typed `unknown` (or `Error`) — the typed subclass passes through without any compile-time signal that the new transient class is being swallowed.

## The pattern

```ts
// Before — correct for generic errors only
try {
  const dividends = await provider.fetchDividends(ticker);
  await persistence.bulkInsertDividends(dividends);
} catch (divErr) {
  log.warn({ err: divErr, ticker }, "dividend fetch failed; continuing backfill");
  // intentional warn-and-continue — graceful degradation for transient FinMind dividend issues
}
```

```ts
// After — re-throws the new typed transient error so outer reschedule logic runs
try {
  const dividends = await provider.fetchDividends(ticker);
  await persistence.bulkInsertDividends(dividends);
} catch (divErr) {
  if (divErr instanceof RateLimitedError) {
    throw divErr; // outer handler reschedules via boss.send({ startAfter })
  }
  log.warn({ err: divErr, ticker }, "dividend fetch failed; continuing backfill");
}
```

## Audit checklist when adding a typed transient-error class

1. Define the error class and its semantics (transient vs terminal, caller action expected).
2. Identify every code path that can throw it.
3. For each path, walk outward through every enclosing `try/catch`:
   - Is the catch generic (catches `Error` / `unknown`)?
   - Does the catch swallow + warn (graceful degradation)?
   - If yes to both → add an `if (err instanceof <YourError>) throw err;` re-throw at the top of the catch body.
4. Add a regression test asserting the error propagates through the previously-swallowing catch.

## Canonical reference

KZO-163 — `apps/api/src/services/market-data/backfillWorker.ts`. The inner dividend `try/catch` warn-and-continues for normal errors (preserves graceful degradation for transient FinMind dividend dataset issues), but explicitly re-throws `RateLimitedError` so the outer reschedule path runs. The regression test "re-throws RateLimitedError from the dividend fetch (warn-and-continue path must not swallow it)" lives in `backfill-handler-branching.test.ts`.

**Why:** Discovered in KZO-163. The `RateLimitedError` was being silently swallowed by the dividend warn-and-continue catch — the outer reschedule signal never fired, and the worker would complete with a half-success instead of pausing for the rate-limit window. Architect flagged the risk during design; Code Reviewer verified the re-throw on the first iteration.

**How to apply:** Any time a new typed error class with "caller-action-required" semantics is introduced. Generalizes beyond rate limits: applies to retry-after, lease-expired, circuit-open, and any other transient-class signal that future tickets may add.

## Companion: Zod schema parse goes BEFORE the existing `try` block

When introducing a Zod schema parse at a job/handler entry on top of pre-existing failure-path logic, the parse **must** live BEFORE the surrounding `try`/`catch`, not inside it. The existing catch block typically calls status-update functions (e.g. `updateBackfillStatus("failed")`), emits SSE events on the final retry, or otherwise mutates persistence/observability state. Running these for a malformed (shape-error) job is wrong — the failure is upstream, not application-level — and the side effects bait future readers into believing the work was attempted.

```ts
// ❌ Wrong — ZodError lands in the existing catch, status flips to "failed",
// SSE backfill_failed event fires, instrument health is corrupted.
return async ([job]: JobWithMetadata<RawJobShape>[]): Promise<void> => {
  try {
    const data = JobDataSchema.parse(job.data);  // throws ZodError on malformed shape
    // ... handler body uses data ...
  } catch (err) {
    if (err instanceof RateLimitedError) { /* reschedule */ return; }
    await updateBackfillStatus(ticker, "failed");  // ← runs on ZodError too!
    await eventBus.publishEvent(userId, "backfill_failed", { ticker, reason });
    throw err;
  }
};

// ✅ Correct — ZodError propagates straight to pg-boss with no side effects.
return async ([job]: JobWithMetadata<RawJobShape>[]): Promise<void> => {
  const data = JobDataSchema.parse(job.data);   // BEFORE try block
  const { ticker, marketCode, userId, ... } = data;

  try {
    // ... existing handler body ...
  } catch (err) {
    if (err instanceof RateLimitedError) { /* reschedule */ return; }
    await updateBackfillStatus(ticker, "failed");
    await eventBus.publishEvent(userId, "backfill_failed", { ticker, reason });
    throw err;
  }
};
```

**Why:** Caught at design time in KZO-185 for `apps/api/src/services/market-data/backfillWorker.ts`. The handler's existing catch path mutates `instruments.bars_backfill_status` and emits `backfill_failed` SSE events on the last retry. An old-shape pgboss job that reaches the parse should NEVER trigger those — the instrument is fine, only the JSONB shape is wrong (e.g. left over from a pre-deploy producer). Putting the parse outside the try block is the only way to guarantee the failure path doesn't execute on shape errors.

This is the placement-side companion to the re-throw rule above. Both apply when adding strict shape validation atop a worker that already has a meaningful failure-path.

**How to apply:** Any handler/worker that gains a Zod (or equivalent) shape parse on top of pre-existing failure-path logic. Default to "BEFORE try" unless there is a documented reason the malformed-shape case should fall into the existing flow.

## Companion: Reschedule path uses parsed `data`, not raw `job.data`

When a worker reschedules itself (e.g. on `RateLimitedError`), the `boss.send(QUEUE, payload, ...)` call **must** pass the **parsed** `data`, not the original `job.data`. Subtle but load-bearing: parsing narrows the shape; re-enqueueing the raw object loses that narrowing and re-introduces the back-compat surface the parse was supposed to eliminate.

```ts
const data = JobDataSchema.parse(job.data);
// ... handler body ...

async function rescheduleAfterRateLimit(err: RateLimitedError): Promise<void> {
  const delaySec = err.retryAfterSeconds;
  const singletonKey = `${data.ticker}:${data.marketCode}`;

  // ❌ Wrong — re-enqueues the raw shape, defeating the parse
  await boss.send(QUEUE, job.data, { startAfter: delaySec, singletonKey });

  // ✅ Correct — re-enqueues the validated, narrowed shape
  await boss.send(QUEUE, data, { startAfter: delaySec, singletonKey });
}
```

**Why:** Caught at design time in KZO-185 for `backfillWorker.rescheduleAfterRateLimit`. If `data = JobDataSchema.parse(job.data)` only validates (no transform), `data` and `job.data` are deep-equal, so the difference is invisible at first glance. But once the schema gains any normalization (`.transform()`, `.default()`, coercion), or a new optional field is dropped, `job.data` carries the un-normalized shape. Re-enqueueing the raw form silently regresses the parse.

**How to apply:** Any worker that owns a self-reschedule path (rate-limit backoff, transient retry, lease renewal, etc.) AND parses its inbound payload with a strict schema. Pre-PR check: every `boss.send(QUEUE, X, ...)` inside the handler — `X` should be the parsed `data` reference, never `job.data` directly.
