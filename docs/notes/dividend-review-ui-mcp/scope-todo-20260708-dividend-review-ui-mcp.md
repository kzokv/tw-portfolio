---
slug: dividend-review-ui-mcp
source: scope-grill
created: 2026-07-08
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Dividend Review UI And MCP Tools

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [x] Render ticker plus instrument display name in dividend review rows and drawer title.
- [x] Change dividend review year source to current open lots through server current year.
- [x] Update `/portfolio/dividends/ledger/years` tests for the new semantics.
- [x] Replace noisy year preset chips with compact checklist-style range dropdown.
- [x] Add `yearRange` preset parsing, URL sync, and tests.
- [x] Add MCP dividend review service with operation-grade row summaries and deep links.
- [x] Add MCP preview/confirm posting tools with full receipt details and stock lot impact preview.
- [x] Add MCP preview/confirm reconciliation tools for all four statuses.
- [x] Wire MCP tool catalog, dispatch, policy expectations, and tool health/list tests.
- [x] Add unit/integration coverage for cash, stock/mixed, deductions/source lines, stale digest, idempotency, and permission failures.
- [x] Run `/aaa` to add or update E2E tests covering the agreed UI/API/MCP flows.

## Open Items

- [ ] Optional: produce a mockup screenshot for the year dropdown and review-row display-name layout.
- [x] Expand MCP dividend service coverage beyond the focused cash/source-line stale-digest regression.

## References

- Scope debate note: none
- Linear tickets: none
