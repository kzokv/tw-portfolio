# Reporting Server-Authoritative DTO Boundary

Formal reporting surfaces must use server-owned report DTOs as the accounting and currency boundary.

- `/reports` pages and MCP report tools must consume typed report DTOs produced by API services, not raw trades plus client-side accounting reconstruction.
- Quantity, average cost, cost basis, realized P&L, unrealized P&L, market value, FX conversion, and report currency fields must come from projections, snapshots, or report DTOs.
- Client code may format, filter displayed rows, preserve cached DTOs, and manage refresh state; it must not derive accounting semantics from raw transaction history for formal reports.
- Historical report chart series must come from server snapshots/read models. If the backend cannot provide a correct series, show an empty or limited state instead of a synthetic client-calculated line.
- Dashboard and report trend/return charts are strict snapshot-only surfaces. Do not reconstruct missing chart points from current holdings, quote snapshots, trade replay, average-cost approximations, or carry-forward logic. If snapshots are missing, stale, provisional, or partially untranslatable, the DTO/UI must expose truthful missing/stale/partial diagnostics and leave the series empty or gapped.
- Scoped snapshot aggregation must preserve the full contributor identity `(accountId, ticker, marketCode)`. Do not guard same-account/same-ticker cross-market cases by disabling scoped snapshots; pass market-qualified pairs into persistence and let the snapshot query filter by market.
- When a formal trend DTO has persisted snapshot aggregates with valid snapshot-date FX, missing replay-only finance FX must not null the whole point. Prefer the persisted snapshot aggregate for market value, cost, return amount, and return percent, and surface a diagnostic for the replay basis gap instead of hiding otherwise valid snapshot-backed chart data.
- All-market formal trend DTOs must prove snapshot contributor completeness for each rendered date. If the latest aggregate date is missing any active `(accountId, marketCode, ticker)` contributor, filter that date out and surface `missing_snapshot`/`stale_snapshot` diagnostics rather than plotting a partial all-market total as complete.
- Formal trend DTOs must expose the server-resolved inclusive range bounds used for the query. Trend and return chart x-axes must render against those bounds, not derive the timeline from the first available snapshot point, so strict snapshot gaps do not compress ranges like 3M or YTD.
- Ticker or compatibility fallbacks may remain only outside formal report surfaces and must be documented as route-specific compatibility, not reused by `/reports` or MCP report tools.
- Report scope/currency behavior stays centralized through shared resolver utilities. Whole-portfolio auto mode uses the user reporting currency; single-market auto mode uses `currencyFor(market)`; specified mode requires an explicit supported currency.
- Dashboard/report summaries must not fall back from missing reporting-currency fields to native amounts while labeling the result as the selected reporting currency. If `reportingMarketValueAmount`, `reportingCostBasisAmount`, or another reporting DTO field is null or absent, show a limited/missing state until the reporting DTO/enrichment path supplies a converted value.

Apply this rule when adding report tabs, report exports, MCP report tools, dashboard report summaries, or currency/market report slices.
