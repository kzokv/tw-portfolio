---
slug: dividend-issues-improvements
source: scope-grill
created: 2026-07-10
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Dividend Issues And Improvements

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

- Treat transaction deletion as a destructive history rewrite. If replay changes an event's ex-date eligible quantity, permanently delete the account-level dividend posting and every linked cash, deduction, source, stock-action, reconciliation, and derived record, then regenerate an unposted expected entitlement.
- Provide an account-scoped **Purge and rebuild from date** operation. The cutoff is inclusive; delete transactions and position actions on or after it, purge affected derived state, and replay surviving history atomically.
- Keep ordinary recompute nondestructive. It creates missing expected entitlements, recalculates expected cash and stock, updates the expected side of posted rows, removes stale system-generated unposted expectations, and reopens reconciliation when expected values change. It never deletes actual postings.
- Require a versioned impact preview and explicit confirmation for every destructive single-record or cutoff purge. Failure must preserve the original financial state.
- Keep a metadata-only audit event for destructive operations: actor, owner, account, target/cutoff, reason, affected-record counts, preview version, timestamp, and result. Do not retain deleted financial payloads.
- Add `dividend:write`. Owners and delegates with this permission may post, reconcile, delete, and purge dividends; users without it remain read-only.
- Store the provider's raw stock-distribution amount separately from an authoritative normalized distribution ratio and instrument par value. Never assume a 10 TWD par value.
- Leave expected stock quantity unresolved and mark the event **Needs action** when no authoritative ratio can be derived.
- Automatically purge legacy stock-dividend postings and linked effects during migration, regenerate corrected expectations, write audit counts, and show a post-migration notification.
- Calculate `expected net = expected gross - NHI - bank fee - other deductions` and `variance = actual net - expected net`. Positive variance means actual receipt exceeded expected net.
- Keep expected entitlement values read-only. Manual expected-value overrides are out of scope.
- Use **Holding activity & dividends** for read-only holdings views. Position-action authoring and preview remain confined to ticker details.
- Use independent server-side pagination for position actions and posted dividends, defaulting to 10 with `10 / 25 / 50` UI options stored in URL state.
- Evaluate Paying Today and Ex-dividend Today against each event's market-local date and display market/date labels in combined sections.
- Keep one responsive Needs Action card with the three highest-priority items and a **View all** action that opens the filtered Review tab.
- Make review sorting stable, server-side, and URL-backed. Ticker links navigate independently from row-to-drawer interaction.
- Split ticker dividends into independent upcoming, open-reconciliation, and posted-history queries. Reuse the review drawer for open items.

## Implementation Steps

- [x] Add shared dividend types for raw stock-distribution amount, normalized distribution ratio, par value, unresolved calculation state, and typed reconciliation values.
- [x] Add database migrations and persistence mappings for the normalized stock-dividend model, `dividend:write`, destructive-operation audit metadata, and any entitlement provenance needed for deterministic rebuilding.
- [x] Correct every market-data provider mapping so provider-specific stock-dividend units normalize to a shares-per-share ratio only when the source data is authoritative.
- [x] Replace all stock entitlement formulas with `floor(eligible quantity * distribution ratio)` and remove hard-coded par-value assumptions from API and web code.
- [x] Implement the one-time legacy stock-dividend migration: purge affected postings and linked position/cash effects, regenerate expectations, capture audit counts, and expose a post-migration notification.
- [x] Build one scoped dividend-entitlement reconciliation service that can create, update, and retire expected rows for an account, ticker, market, and replay range.
- [x] Update ordinary recompute to invoke entitlement reconciliation without deleting posted actual values, deductions, or linked stock actions; reopen changed reconciliations.
- [x] Add a versioned destructive-impact preview API for single-transaction deletion, including affected transactions, dividends, cash entries, deductions, stock actions, reconciliation state, snapshots, and required receipt re-entry.
- [x] Make confirmed transaction deletion atomic: delete the source transaction, purge every dividend whose eligible quantity changes, remove all linked effects, replay positions, and regenerate expectations.
- [x] Add an account-scoped, inclusive cutoff preview and confirmation API for **Purge and rebuild from date**, including transactions and position actions on or after the cutoff.
- [x] Ensure destructive confirmation rejects stale preview versions and rolls back all changes when replay or regeneration fails.
- [x] Persist metadata-only audit events for successful and failed owner/delegate destructive operations without retaining deleted financial payloads.
- [x] Add `dividend:write` to shared capability types, database constraints, presets, authorization guards, grant-management UI, labels, and owner-context audit handling.
- [x] Map dividend posting, reconciliation, transaction-triggered dividend deletion, and purge/rebuild routes to `dividend:write`.
- [x] Standardize API and UI reconciliation calculations around expected gross, typed deductions, expected net, actual net, and signed actual-minus-expected variance.
- [x] Extend dividend review responses with exact NHI, bank-fee, other-deduction, expected-net, actual-net, and variance values suitable for independent columns and sorting.
- [x] Make review sorting deterministic across persisted ledger rows and generated expected rows, reset pagination on sort changes, and preserve sort/page state in URL parameters.
- [x] Add explicit ticker-detail links to desktop and mobile review rows without triggering the review drawer.
- [x] Redesign the review drawer to show cash and stock calculations before editable actual receipt fields, including formula breakdowns and unresolved stock-ratio states.
- [x] Add dedicated market-local queries for Paying Today and Ex-dividend Today so ex-date results are independent of the selected payment-date month.
- [x] Refactor the overview layout to remove fixed side-column assumptions, make the This Month content responsive, and consolidate Needs Action into one top-three summary card.
- [x] Extract reusable server-paginated position-activity, upcoming-dividend, and posted-dividend components from `HoldingActionDetail`.
- [x] Replace portfolio holdings action previews with the read-only **Holding activity & dividends** surface and add quick links in detailed portfolio, compact portfolio, and dashboard holdings tables.
- [x] Keep ticker Position Actions authoring as a full-width, container-responsive section; remove duplicated holding metrics and stack the preview below the form when space is constrained.
- [x] Add independent ticker-dividend endpoints/read models for upcoming events, open reconciliation, and paginated posted history.
- [x] Update ticker posted-history titles to ticker number, ticker name, and payment date; show ex-dividend and posted dates in entry details.
- [x] Reuse the dividend review drawer for ticker open-reconciliation items and exclude reversed or superseded entries from active results.
- [x] Add focused domain and unit tests for stock ratios, non-10/no-par instruments, unresolved events, expected-net variance, and entitlement lifecycle transitions.
- [x] Add memory and Postgres integration tests for recompute materialization, single-transaction destructive replay, cutoff purge atomicity, legacy migration, audit metadata, and owner/delegate authorization.
- [x] Add API tests for market-local daily highlights, independent open reconciliation, pagination, deterministic sorting, stale-preview rejection, and failure rollback.
- [x] Run `/aaa` to add or update E2E tests covering destructive previews and confirmation, delegated dividend writes, review navigation/sorting, reconciliation formulas, pagination, daily highlights, and ticker/holdings workflows.
- [x] Add responsive visual coverage at mobile, tablet, constrained desktop, and wide desktop sizes for This Month, Needs Action, review drawer, holdings activity, and ticker Position Actions.
- [x] Run the smallest relevant test scopes first, then complete all eight repository-required validation suites before declaring the implementation complete.
- [x] Revisit this file after implementation and change each delivered checkbox to `- [x]`; leave undelivered scope visible for follow-up.

## Open Items

- [x] None.

## References

- Scope debate note: none; the contested deletion semantics were resolved during interrogation without spawning a debate.
- Linear tickets: none.
- Replay lifecycle: `apps/api/src/services/replayPositionHistory.ts`, `apps/api/src/services/dividends.ts`
- Recompute lifecycle: `apps/api/src/services/recompute.ts`
- Shared authorization: `apps/api/src/lib/routeGuards.ts`, `apps/api/src/routes/registerRoutes.ts`
- Review UI: `apps/web/components/dividends/DividendReviewClient.tsx`, `apps/web/components/dividends/DividendPostingForm.tsx`
- Holdings UI: `apps/web/components/holdings/HoldingActionDetail.tsx`
- Ticker dividends: `apps/web/components/dividends/TickerDividendsTab.tsx`
