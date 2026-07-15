---
slug: dividend-delete-recompute-ux
source: scope-grill
created: 2026-07-14
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Dividend deletion and recompute history UX

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

1. Recompute History presents a run-level fee choice and defaults to `KEEP_RECORDED`.
2. `RECALCULATE_CALCULATED` updates commission and transaction tax together only for trades whose fee provenance is `CALCULATED`.
3. `MANUAL` and `SOURCE_PROVIDED` amounts remain immutable under bulk recompute.
4. Omitted HTTP and MCP fee modes default to `KEEP_RECORDED`.
5. Recalculation shows an aggregate preview grouped by native currency and requires a second confirmation.
6. Recompute previews are fingerprinted; stale previews refresh and require reconfirmation.
7. Calculated-only repricing is an audited in-place exception: refresh the trade fee-policy snapshot and record the applied profile plus previous/next amounts.
8. Full-store persistence preserves `CALCULATED`, `MANUAL`, and `SOURCE_PROVIDED` provenance.
9. Both fee modes run a complete deterministic core history replay. Core changes are synchronous and atomic; holding and wallet snapshots remain asynchronous.
10. Destructive transaction deletion compares JSONB-backed preview data canonically without making array order insignificant.
11. Expired or changed deletion previews refresh automatically but are never auto-confirmed.
12. The deletion modal remains locked with visible progress while confirmation is running.
13. Dividend Review explains removal/correction paths and links to the related ticker's Transactions tab; it does not add direct dividend deletion.

## Implementation Steps

- [x] Add a canonical recursive comparison/serialization helper for destructive-preview object values, preserving array order, and use it in `sameReviewedSet`.
- [x] Add API coverage proving a destructive preview survives a Postgres JSONB round trip and confirms when no semantic row drift occurred; retain coverage for genuine drift rejection.
- [x] Introduce shared/API fee-mode types for `KEEP_RECORDED` and `RECALCULATE_CALCULATED`; default omitted HTTP and MCP inputs to `KEEP_RECORDED`.
- [x] Add a migration and baseline-schema updates for persisted recompute mode, expanded job status, preview fingerprint/expiry metadata, and per-item applied fee-profile audit data.
- [x] Expand booked trade fee provenance to include `SOURCE_PROVIDED`, and preserve `fees_source` in full-store Postgres load/save paths.
- [x] Add managed Postgres integration coverage proving all three fee-source values and manual zero commissions survive full recompute/replay round trips.
- [x] Rework recompute preview generation so `KEEP_RECORDED` retains stored commission/tax and `RECALCULATE_CALCULATED` recalculates only `CALCULATED` trades using the resolved ticker override or account fallback profile.
- [x] Return aggregate preview counts and commission/tax deltas grouped by native currency, including a clear zero-change result.
- [x] Fingerprint the reviewed trades, fee provenance, and resolved fee profiles; enforce expiry and drift validation consistently for HTTP and MCP confirmation.
- [x] Persist recompute transitions through previewed, running, confirmed, and failed states, including the selected mode and applied profile per affected trade.
- [x] On calculated-only confirmation, update commission/tax and the exact fee-policy snapshot used while retaining previous/next values in recompute audit items.
- [x] Simulate and validate every selected account/ticker scope before persistence, then commit the complete core replay atomically; leave the original portfolio unchanged on failure.
- [x] Rebuild lots, positions, settlement cash, realized P&L, and dividend entitlements synchronously for either fee mode; queue holding and wallet snapshot regeneration only after the atomic core commit.
- [x] Update MCP recompute preview/confirm summaries and confirmation digests to include mode, currency-grouped impacts, fingerprint, expiry, and applied profiles.
- [x] Update the web portfolio service and recompute hook to carry the selected mode, load the preview, handle stale-preview refresh, and confirm only the reviewed preview.
- [x] Extend the recompute confirmation dialog with a default `Keep recorded fees` choice, a `Recalculate profile-derived fees` choice, currency-grouped impact summary, zero-change messaging, second confirmation, and visible pending/error states.
- [x] Add `isDeleteSubmitting` state to transaction mutations; prevent duplicate confirmation and modal dismissal while deletion is running, and restore controls on failure.
- [x] Show a spinner and `Deleting…` label during deletion confirmation; keep the impact summary visible and render specific errors inside the modal.
- [x] On destructive-preview expiry or drift, fetch and display a fresh preview, explain that the impact changed, and require another explicit Delete click.
- [x] Add localized Dividend Review guidance distinguishing generated expected entries from posted corrections, and add an `Open ticker transactions` action without a direct dividend-delete action.
- [x] Add `tab=transactions` support to ticker-detail routing and preserve `marketCode` and `accountId` in Dividend Review navigation.
- [x] Add focused API service, route, persistence, hook, component, and i18n tests for all changed behaviors.
- [x] Run `/aaa` to add or update E2E tests covering the recompute choice/preview flow, deletion progress and stale-preview recovery, and Dividend Review navigation.
- [x] Run the smallest relevant checks first, followed by `npm run typecheck`, web tests, API tests, and `npm run test:integration:full:host`; report any broader suites not run.

## Open Items

- [x] None.

## Explicitly Out Of Scope

- Direct dividend deletion from Dividend Review.
- Bulk overwriting of `MANUAL` or `SOURCE_PROVIDED` fees.
- Per-trade fee selection in the recompute dialog.
- Combining native-currency impacts into one reporting-currency total.
- Reversal/replacement modeling for calculated-only fee repricing.
- New asynchronous recompute-job infrastructure.

## References

- Destructive preview comparison: `apps/api/src/services/dividendDestructivePreview.ts`
- Recompute service: `apps/api/src/services/recompute.ts`
- Replay engine: `apps/api/src/services/replayPositionHistory.ts`
- Postgres persistence: `apps/api/src/persistence/postgres.ts`
- Recompute UI hook/dialog: `apps/web/features/portfolio/hooks/useRecomputeAction.ts`, `apps/web/components/portfolio/RecomputeConfirmDialog.tsx`
- Deletion UI hook/dialog: `apps/web/features/portfolio/hooks/useTransactionMutations.ts`, `apps/web/components/portfolio/DeleteConfirmationDialog.tsx`
- Dividend guidance: `apps/web/components/dividends/DividendReviewDrawer.tsx`, `apps/web/features/dividends/i18n.ts`
