# Pgboss Producer Convention: Composite SingletonKey `${ticker}:${marketCode}`

Every producer that enqueues to the `finmind-backfill` queue (or any analogous market-data queue) must use a composite `singletonKey` of the form `` `${ticker}:${marketCode}` `` — never a bare `ticker`.

## Why composite

Cross-listed tickers exist post-KZO-169: `BHP/AU` and `BHP/US` share the same `ticker` string but route through different market-data providers. With `singletonKey: ticker`, the second `boss.send` for `BHP` would be silently dropped as a duplicate by pg-boss's singleton policy — the user would see a successful enqueue response but the job would never run. Composite-keyed sends keep the two markets in distinct singleton slots.

The same reasoning applies to any future cross-listed instrument expansion (HK, JP, SG) and to any new queue whose payload shape is `(ticker, marketCode, …)`.

## The rule

For every `boss.send(BACKFILL_QUEUE, payload, options)` call:

```ts
// ❌ Wrong — collapses BHP/AU and BHP/US into the same singleton slot
await boss.send(BACKFILL_QUEUE, { ticker, marketCode, ... }, {
  singletonKey: ticker,
});

// ✅ Correct
await boss.send(BACKFILL_QUEUE, { ticker, marketCode, ... }, {
  singletonKey: `${ticker}:${marketCode}`,
});
```

Same convention applies to the worker's self-reschedule path:

```ts
// In rescheduleAfterRateLimit (or any worker-internal re-enqueue)
const singletonKey = `${data.ticker}:${data.marketCode}`;
await boss.send(BACKFILL_QUEUE, data, { startAfter, singletonKey, priority });
```

## Walker / set semantics follow the same idiom

When a service collects `tickersNeedingBackfill` (or any analogous "things to enqueue" set) from a walker, the in-memory set must key on `${ticker}:${marketCode}` too — bare-ticker keys collapse cross-listed entries before they ever reach `boss.send`:

```ts
// Inside snapshotGeneration.ts walker
const tickersNeedingBackfill = new Map<string, { ticker: string; marketCode: MarketCode }>();
for (const trade of tradesByAccountTicker) {
  const compositeKey = `${trade.ticker}:${trade.marketCode}`;
  tickersNeedingBackfill.set(compositeKey, { ticker: trade.ticker, marketCode: trade.marketCode });
}
return { tickersNeedingBackfill: [...tickersNeedingBackfill.values()] };
```

## Audit checklist for any new producer

When adding a new producer to `finmind-backfill` (or extending any analogous market-data queue):

1. Grep `boss.send(BACKFILL_QUEUE` (or the relevant constant) for every existing call site.
2. Confirm each existing site uses the composite key — they're the precedent.
3. New site uses the composite key too.
4. If your producer sources tickers from a walker / persistence query, confirm the source preserves `marketCode` (e.g. `getAllMonitoredTickers` returns `{ticker, marketCode}[]`, not `string[]`). Per-ticker `getInstrument(ticker)` lookups silently pick the wrong market for cross-listed cases — avoid.
5. The Zod schema that the worker uses to parse incoming jobs must require `marketCode` (no `?? "TW"` fallback). Companion: `.claude/rules/typed-transient-error-catch-audit.md`.

## Why this is a rule

Promoted from KZO-185 auto-memory after the convention propagated to four producer call sites in one PR (`dailyRefreshEnqueue`, `POST /portfolio/snapshots/generate` auto-trigger, `POST /portfolio/recompute/confirm` auto-trigger, `backfillWorker.rescheduleAfterRateLimit`). KZO-169 introduced the convention for the worker reschedule path; KZO-185 propagated it to the three latent producer sites that were silently masking it via the old `?? resolveMarketCode(ticker)` fallback. The convention is now load-bearing — bare-ticker singleton keys would re-introduce a cross-market collision class that bit-rots silently because the failure mode is "second job is a no-op," not a thrown error.

## Canonical references

- `apps/api/src/services/market-data/dailyRefreshEnqueue.ts` — daily-refresh cron producer
- `apps/api/src/routes/registerRoutes.ts` — `/portfolio/snapshots/generate` and `/portfolio/recompute/confirm` auto-trigger producers; `/monitored-tickers` PUT producer; `/backfill/retry` and `/backfill/repair` producers
- `apps/api/src/services/market-data/backfillWorker.ts:rescheduleAfterRateLimit` — worker self-reschedule

## How to apply

- Any time a new `boss.send` call to `BACKFILL_QUEUE` (or any future per-market queue) is added: use the composite key.
- Any time a service or walker emits a "set of (ticker, marketCode) pairs to enqueue": key the in-memory collector on the composite string, never on bare `ticker`.
- Pre-PR check: `grep -nE "boss\.send\(BACKFILL_QUEUE" apps/api/src` — every match should have `singletonKey: \`${...}:${...}\`` in the options object.
- When adding a new market (HK, JP, SG, etc.): the convention extends without code changes — `${ticker}:${marketCode}` covers it as long as the producer stamps the correct `marketCode`.
