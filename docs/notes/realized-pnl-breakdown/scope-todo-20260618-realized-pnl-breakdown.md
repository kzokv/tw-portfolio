---
slug: realized-pnl-breakdown
source: scope-grill
created: 2026-06-18
tickets: []
required_reading: []
superseded_by: docs/notes/combined-ui-improvements/scope-todo-202606201249-combined-ui-improvements.md
---

# Todo: Realized P&L Breakdown

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Realized P&L only; unrealized P&L is out of scope.
- Add row-level details for SELL transaction rows wherever realized P&L renders.
- Use backend-provided `realizedPnlBreakdown`; frontend must not infer accounting math.
- Desktop uses an icon-triggered popover; mobile uses inline disclosure.
- Summary-only breakdown; do not show matched lot rows.
- Add a visible muted table note on `/transactions` and ticker transaction history only.
- Include pre-sale pool totals, exact average, rounded average used, allocated cost, net proceeds, and final formula.
- Derive breakdown on read; do not add a schema migration.
- Use native trade currency only.
- If the breakdown is unavailable, show a reason/message and no recompute action.
- Expose to owners and authenticated shared transaction readers; exclude public anonymous share views.
- BUY rows have no realized P&L trigger.
- Dashboard recent-transactions rows get the row trigger, but no table-level note.
- Test with API coverage, component coverage, and one `/transactions` E2E disclosure test.

## Implementation Steps

- [x] Add `RealizedPnlBreakdownDto` to shared transaction types with `available` and `unavailable` variants.
- [x] Add a backend read-model helper that derives weighted-average realized P&L breakdowns by replaying account/ticker/market trades.
- [x] Include pre-sale open quantity, pre-sale open cost, exact average cost/share, rounded average used, allocated cost, gross proceeds, commission, tax, net proceeds, and realized P&L in the available variant.
- [x] Return unavailable reasons such as `insufficient_quantity`, `currency_mismatch`, `unsupported_cost_basis_method`, and `unknown` when derivation cannot safely explain a SELL row.
- [x] Reuse the backend helper in `/portfolio/transactions` and ticker details transaction DTO mapping.
- [x] Add row-level realized P&L breakdown UI for `TransactionHistoryTable`.
- [x] Add row-level realized P&L breakdown UI for `RecentTransactionsCard`, including dashboard usage.
- [x] Add a visible weighted-average note to `/transactions` and ticker transaction history only.
- [x] Keep dashboard compact: row trigger only, no table-level note.
- [x] Ensure BUY rows render no realized P&L breakdown trigger.
- [x] Add API tests for available breakdowns, BUY/null breakdowns, and unavailable breakdown reasons.
- [x] Add component tests for SELL trigger, BUY trigger absence, available math, and unavailable message.
- [x] Run `/aaa` or add E2E coverage for opening the breakdown on `/transactions`.

## Open Items

- [x] None.

## Evidence / Validation

- Superseded into the combined UI improvements scope doc listed in `superseded_by`.
- Shared DTO, backend read model, route mapping, transaction/dashboard UI, weighted-average notes, and BUY-row trigger absence are implemented in the combined PR worktree.
- API coverage passed for available breakdowns, BUY/null breakdowns, and unavailable reasons: `apps/api/test/unit/realizedPnlBreakdown.test.ts`, `apps/api/test/integration/portfolio.integration.test.ts`, and `apps/api/test/integration/ticker-details.integration.test.ts`.
- Component coverage passed for SELL trigger, BUY trigger absence, available math, and unavailable message: `apps/web/test/components/portfolio/RealizedPnlBreakdown.test.tsx`.
- E2E coverage passed for opening the `/transactions` SELL-row breakdown: `apps/web/tests/e2e/specs/combined-ui-improvements-aaa.spec.ts`.

## References

- Mockup: `docs/notes/realized-pnl-breakdown/mockups/realized-pnl-breakdown.html`
- Desktop screenshot: `docs/notes/realized-pnl-breakdown/mockups/realized-pnl-desktop.png`
- Mobile screenshot: `docs/notes/realized-pnl-breakdown/mockups/realized-pnl-mobile.png`
