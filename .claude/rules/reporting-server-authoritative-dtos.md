# Reporting Server-Authoritative DTO Boundary

Formal reporting surfaces must use server-owned report DTOs as the accounting and currency boundary.

- `/reports` pages and MCP report tools must consume typed report DTOs produced by API services, not raw trades plus client-side accounting reconstruction.
- Quantity, average cost, cost basis, realized P&L, unrealized P&L, market value, FX conversion, and report currency fields must come from projections, snapshots, or report DTOs.
- Client code may format, filter displayed rows, preserve cached DTOs, and manage refresh state; it must not derive accounting semantics from raw transaction history for formal reports.
- Historical report chart series must come from server snapshots/read models. If the backend cannot provide a correct series, show an empty or limited state instead of a synthetic client-calculated line.
- Ticker or compatibility fallbacks may remain only outside formal report surfaces and must be documented as route-specific compatibility, not reused by `/reports` or MCP report tools.
- Report scope/currency behavior stays centralized through shared resolver utilities. Whole-portfolio auto mode uses the user reporting currency; single-market auto mode uses `currencyFor(market)`; specified mode requires an explicit supported currency.

Apply this rule when adding report tabs, report exports, MCP report tools, dashboard report summaries, or currency/market report slices.
