---
slug: kzo-180
type: transition
created: 2026-04-29
tickets: [KZO-180]
---

# Transition: KZO-180 reporting currency

KZO-180 ships the user-level `preferences.reportingCurrency` JSONB key and makes dashboard reads FX-aware without adding a database migration. The resolver defaults missing, null, or invalid stored values to `TWD`; valid persisted values are `TWD`, `USD`, and `AUD`.

Dashboard overview now translates only the rolled-up summary KPI amounts into the reporting currency. Per-holding rows and per-event dividend rows stay native. Dashboard performance now returns response-level `reportingCurrency` and `fxStatus`; each point includes `fxAvailable`, and all five point numeric fields are `null` when FX is unavailable.

The persistence path uses `getAggregatedSnapshotsInReportingCurrency(...)` with snapshot-date FX forward-fill and an explicit self-pair guard. The guard is load-bearing because `market_data.fx_rates` does not store self-pairs such as `TWD -> TWD`. KZO-180 v1 translates denormalized cumulative realized P&L at snapshot-date FX; strict sale-date attribution remains KZO-176 scope.

The settings Display tab includes an immediate-save reporting-currency selector. A successful change refetches dashboard overview and performance data so labels and totals pick up the new preference.
