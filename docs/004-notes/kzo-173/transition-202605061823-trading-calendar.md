# KZO-173 Trading Calendar Transition Note

KZO-173 ships additive service-layer trading-calendar helpers derived from existing `market_data.daily_bars` rows. It intentionally does not add a `market_trading_calendar` table, migration, seed file, admin route, external holiday library, or scheduler holiday skip.

## Decision

The implementation uses Option α from scope-grill: distinct `daily_bars.bar_date` values are the trading calendar for each equity market. That makes the exchange-published bar feed the authority instead of a manually maintained holiday dataset.

Trade-off accepted: the daily refresh scheduler may still run on holidays, wasting a small amount of provider quota, but the app avoids calendar drift, manual seed maintenance, and another operational surface.

## API Shape

The Fastify app decorates `app.tradingCalendarCache` with:

```ts
await app.tradingCalendarCache.latestSettledTradingDay("TW", new Date(), {
  settleGraceHours: 14,
});
await app.tradingCalendarCache.tradingDaysBetween("2026-05-01", "2026-05-05", "US");
await app.tradingCalendarCache.isTradingDay("AU", "2026-05-04");
```

Pure helper exports are available for unit tests that need deterministic math without cache or persistence setup:

```ts
latestSettledTradingDayPure(dates, "TW", now, options);
tradingDaysBetweenPure(dates, d1, d2, "US");
isTradingDayPure(dates, "FX", date);
```

## Behavior

- Equity calendars refresh from `Persistence.getDistinctBarDates(market, fromDate)` with a 400-day lookback and 1-hour TTL.
- Daily-bar upserts notify the cache after successful writes; e2e seed data does the same for memory-backed tests.
- `latestSettledTradingDay` uses market-local close times and optional `settleGraceHours`.
- `tradingDaysBetween` uses `(d1, d2]` semantics.
- `FX` is synthetic: weekdays only, with a 16:00 UTC publish threshold.
- Empty or stale equity calendars fall back to weekday logic and emit `trading_calendar_bootstrap_fallback` once per refresh window.

## Known Limitations

- KZO-192 owns ECB/TARGET2 holiday awareness for synthetic FX.
- KZO-193 owns early-close session handling for TW, US, and AU equities.
- KZO-191 owns refactoring existing `isWeekendIsoDate` and quote snapshot callers to consume `app.tradingCalendarCache.isTradingDay`.
- Cross-instance cache coordination is not implemented; another API instance can lag until its TTL refreshes.
