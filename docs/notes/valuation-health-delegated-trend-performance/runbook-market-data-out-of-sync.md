# Market Data Out Of Sync Runbook

Created: 2026-06-16

## What The Warning Means

`Market data out of sync` means current holdings valuation and snapshot-backed Portfolio Trend valuation are not comparing against the same market-data coverage.

The dashboard now distinguishes:

- latest partial snapshot date: a newer trend point that is renderable but missing one or more active contributors
- latest comparable snapshot date: the newest snapshot date with every active contributor present
- valuation health baseline: current hero valuation compared only against the latest comparable snapshot

This prevents AU/KR-only or otherwise partial points from hiding a stale US data issue.

## Correct Repair Order

1. Backfill stale or missing market data bars for affected tickers.
2. Wait until the backfill operation reaches a terminal state.
3. Repair snapshots only for tickers whose latest bar date reaches the target repair date.
4. Refresh Portfolio Trend and valuation health.
5. Treat the issue as fixed only when snapshot readiness reaches the target date, not when the backfill job merely completes.

Regenerating snapshots before bars exist cannot fix stale chart valuation because snapshot repair has no current price data to consume.

Admin repair links use the dashboard's expected latest valuation date as the target. This matters when an affected market is behind: the repair flow must advance bars and snapshots to the expected date, not merely to the stale latest bar date.

## Admin Guided Repair

Admin repair links open Admin Market Data backfill with `repair=valuation`, affected tickers, target repair date, and requested range prefilled.

The guided flow:

1. Loads repair readiness from the admin-only valuation-repair status endpoint.
2. Blocks impossible snapshot prompts when the target date is a market holiday or the latest bar is still before the target date.
3. Previews a bounded bars-plus-dividends backfill for the affected ticker batch.
4. Displays requested start/end, effective start/end, provider floor, and whether the start was clamped.
5. After terminal backfill state, refreshes readiness and auto-queues snapshot repair only for eligible tickers.
6. Polls snapshot readiness after snapshot repair is queued.
7. Keeps ineligible or already-complete tickers visible with latest bar, latest snapshot, scope count, and reason labels.

`Fix complete` means every affected ticker has snapshot readiness at or after the target repair date. Backfill job completion alone is not enough.

## Viewer To Admin Handoff

Non-admin viewers cannot run repair actions. The valuation-health panel shows copyable admin-help links per affected market. Admin users can open those links to the prefilled Admin Market Data backfill workspace.

The generated links include:

- market
- ticker batch, capped at 20 tickers per link
- target repair date
- requested start/end range

## Performance Expectations

Dashboard and Portfolio Trend restore route DTOs from per-tab `sessionStorage` when cached data is inside the configured fresh or stale-usable window. Fresh cache entries render without a server request. Stale-usable entries render immediately, then refresh in the background.

The 2-3 second target applies to warm frontend rendering of Dashboard, Portfolio Trend, and the guided repair UI. It excludes provider backfill and snapshot repair job duration, which depends on market-data providers and queue load.

## Current Implementation Status

Implemented:

- valuation health uses latest fully comparable snapshot
- Portfolio Trend preserves partial points with marker metadata and UI marker
- per-market admin repair links and non-admin copy flow
- backend admin backfill requested/effective date range plumbing
- admin UI requested/effective date range display
- market-calendar-aware repair readiness endpoint
- guided admin valuation-repair mode
- status-driven eligible-only snapshot repair
- partial success reason display
- duplicate Dashboard hero valuation-health card removed
- delegated Portfolio Trend performance currency follows owner/context summary currency
- warm Portfolio Trend cache restore keeps data visible without blocking on a new request, with stale-usable entries refreshing in the background
- mockup screenshots for Portfolio Trend mismatch, viewer handoff, and admin guided repair
- focused E2E for non-admin copied admin-help link, admin guided repair deep-link prefill, and delegated/shared Portfolio Trend owner-context currency

Still open:

- live dev validation and full repo gates
