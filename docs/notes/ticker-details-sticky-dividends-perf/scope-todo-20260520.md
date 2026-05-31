---
slug: ticker-details-sticky-dividends-perf
source: scope-grill
created: 2026-05-20
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Ticker Details, Sticky Top Bar, Dividends Performance

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Make the global app shell top bar sticky to the viewport top while page content scrolls on desktop and mobile.
- Rebuild ticker details to match the supplied mockup direction, including quote header, position summary, price chart, tabbed detail sections, fundamentals panel, and floating quote summary.
- Add a dedicated backend fundamentals provider boundary for TW, US, and AU markets.
- Persist fundamentals as stored facts with background refresh. Ticker page rendering must read stored facts first and must not block on upstream fundamentals calls.
- Use a shared nullable fundamentals DTO with per-field `source` and `asOf` metadata. Missing provider fields render as unavailable states, not fabricated data.
- Optimize Dividend Review load and Review to Calendar switching as a full performance fix, not just a measurement task.
- Use Chrome DevTools/Codex Chrome measurements against the hosted dev deployment for before/after evidence.

## Measurement Evidence

- Hosted dev URL measured: `https://vakwen-dev-web.kzokvdevs.dpdns.org/dividends?view=ledger`
- Review page load LCP was about `15.1s`.
- Document TTFB/server latency was about `13.5s`.
- Document request total was about `14.4s`.
- Review to Calendar interaction INP was about `30ms`, so the click handler is not the primary bottleneck.
- Resource timing showed duplicate/long route work around tab switching, including duplicate `/dividends?_rsc=...` fetches around `10.7s` and `13.8s`, calendar API fetches around `4.5s`, and another `/dividends?view=ledger&_rsc=...` fetch around `16.0s`.
- Follow-up hosted dev measurement on 2026-05-20 before deployment still showed the old behavior: Calendar to Review issued duplicate `/dividends?view=ledger&_rsc=...` fetches around `11.1s` and `15.3s`; Review to Calendar issued duplicate `/dividends?_rsc=...` fetches around `9.7s` and `13.4s`, plus a calendar ledger API fetch around `4.5s`. Post-fix hosted re-measurement remains pending deployment.

## Implementation Steps

- [x] Verify the top bar stickiness failure mode in the app shell scroll container and fix the global layout so `data-testid="topbar"` remains pinned while `shell-main` content scrolls.
- [x] Add responsive visual/regression coverage for sticky top bar behavior on at least dashboard, ticker details, and dividends pages.
- [x] Design and add shared ticker-details DTOs covering identity, quote snapshot, position summary, chart series, transactions, dividends, fundamentals, and field freshness metadata.
- [x] Add a dedicated fundamentals provider interface for TW, US, and AU with per-field nullable outputs and `source`/`asOf`.
- [x] Add persistence for fundamentals facts and refresh metadata in memory and Postgres, including migrations and parity coverage.
- [x] Add a background refresh path for ticker fundamentals so page requests do not call upstream providers directly.
- [x] Implement a market-aware ticker details API endpoint that aggregates holdings, transactions, quote snapshots, daily bars, dividends, and persisted fundamentals.
- [x] Rebuild `/tickers/[ticker]` to match the supplied mockup direction with header quote, stat cards, chart, tabs, fundamentals panel, and floating quote summary.
- [x] Preserve existing transaction record/edit/delete workflows from the current ticker history page, either in the Transactions tab or an equivalent detail section.
- [x] Refactor `/dividends` server/client data loading so initial render fetches only the active tab's required payload, with lazy loading or controlled prefetch for inactive tab data.
- [x] Remove duplicate Review and Calendar fetches during tab switches; switching Review to Calendar should not re-fetch ledger review data unless filters are stale or explicitly changed.
- [x] Add performance instrumentation or tests that assert route/tab switching does not issue duplicate RSC/API fetches for inactive dividend tabs.
- [ ] Re-measure hosted dev with Chrome DevTools after the fix. Target Review initial visible content under `1.5s` and Review to Calendar visible switch under `500ms` on a warmed dev deployment with normal network.
- [x] Run `/aaa` to add or update E2E tests covering the user-facing sticky top bar, ticker details, and dividends tab flows agreed in this scope session.
- [x] Run the smallest relevant checks first, then broader web/API regression checks based on touched files.

## Open Items

- [x] Select exact upstream fundamentals providers for TW, US, and AU during implementation. Provider choice is Yahoo Finance via the dedicated fundamentals provider boundary for v1; cached persistence remains the page-read source.
- [x] Decide whether the ticker details chart should use raw daily bars directly or a downsampled API response for long ranges. V1 uses raw one-year daily bars from the existing persisted market-data table.
- [x] Decide whether fundamentals refresh gets a visible manual refresh action in v1 or only background scheduling. V1 uses background scheduling only.

## References

- Mockup: user-provided image in the scope-grill conversation.
- Relevant shell files: `apps/web/components/layout/TopBar.tsx`, `apps/web/components/layout/AppShellLayout.tsx`.
- Relevant ticker files: `apps/web/app/tickers/[ticker]/page.tsx`, `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`.
- Relevant dividends files: `apps/web/app/dividends/page.tsx`, `apps/web/components/dividends/DividendsTabsClient.tsx`, `apps/web/components/dividends/DividendReviewClient.tsx`, `apps/web/components/dividends/DividendCalendarClient.tsx`.
- Relevant market-data files: `apps/api/src/services/market-data/types.ts`, `apps/api/src/services/market-data/quoteSnapshotService.ts`, `apps/api/src/routes/registerRoutes.ts`.
