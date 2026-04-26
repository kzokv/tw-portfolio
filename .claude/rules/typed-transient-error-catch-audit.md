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
