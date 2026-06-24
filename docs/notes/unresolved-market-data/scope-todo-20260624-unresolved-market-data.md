---
slug: unresolved-market-data
source: scope-grill
created: 2026-06-24
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Unresolved Market Data

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [ ] Add a generic `Unresolved` market-data tab for all non-FX workspaces.
- [ ] Keep `/admin/market-data/KR/mappings` route compatibility by aliasing or redirecting it to the KR unresolved experience.
- [ ] Extend market overview data so the UI shows both active unresolved rows and affected instrument count.
- [ ] Add market-scoped unresolved endpoints backed by existing provider unresolved persistence:
  - `GET /admin/market-data/:marketCode/unresolved`
  - `POST /admin/market-data/:marketCode/unresolved/state`
  - `POST /admin/market-data/:marketCode/unresolved/state/bulk`
- [ ] Include unresolved summaries by provider, error code, state, active row count, affected instrument count, and oldest unresolved timestamp.
- [ ] Build the Unresolved tab table with provider, source symbol, instrument name, error code, latest evidence/error, occurrence count, first/last seen, state, and recommended action.
- [ ] Add filters for provider, state, error code, search, sort, page, and limit.
- [ ] Add CSV export for the current unresolved view.
- [ ] Add lifecycle actions: ignore, mark unsupported, reopen, and bulk ignore/unsupported with confirmation guardrails.
- [ ] Fold KR mapping repair UI into the KR Unresolved tab while keeping durable mappings visible as a dedicated section.
- [ ] Keep KR automated repair provider-specific; do not add generic repair engines for TW, US, or AU.
- [ ] Add non-KR `Retry via backfill` that bridges selected unresolved rows into the existing guarded backfill preview/execute flow.
- [ ] Deduplicate retry execution by provider, market, and source symbol, while preserving selected unresolved row identities for preview copy, execution reporting, and resolution accounting.
- [ ] Update backfill preview/execute responses and UI copy for unresolved retry so they distinguish selected unresolved rows, deduped backfill targets, and resolved rows.
- [ ] Auto-resolve non-KR unresolved rows only after high-confidence successful provider work for the matching provider, market, and source symbol.
- [ ] Keep ignored and unsupported rows out of auto-resolution.
- [ ] Keep KR mapping rows resolved only through mapping repair, not generic backfill success.
- [ ] Improve active-operation conflict responses with blocking operation id, provider, market, operation type, phase, and timestamps.
- [ ] Show blocker details in the Unresolved tab and action errors, with an Open operation affordance and allowed Resume/Cancel actions where already supported.
- [ ] Keep provider operation concurrency semantics unchanged; paused operations still block until manually resumed or cancelled.
- [ ] Add focused API tests for market-scoped unresolved list, summaries, lifecycle actions, bulk guardrails, blocker details, and retry deduplication.
- [ ] Add focused frontend/component tests for the generic Unresolved tab, KR mapping fold-in, non-KR retry bridge, duplicate-row accounting, lifecycle actions, and blocker banner.
- [ ] Run `/aaa` or equivalent focused E2E coverage for the new user-facing unresolved flows.

## Open Items

- [ ] Decide during implementation whether KR mappings route compatibility is a redirect or an alias render; prefer the least disruptive option for existing deep links.

## Out Of Scope

- Provider selection changes or new providers.
- Yahoo KR resolver algorithm rewrites beyond using the existing repair flow.
- Provider operation concurrency policy changes.
- Auto-cancelling paused operations.
- One-click non-KR repair that bypasses backfill preview/execute guardrails.
- Solving every AU no-data/delisted case automatically.
- Provider health threshold changes beyond clearer unresolved count display.
- Purging unresolved rows as the normal fix path.

## References

- Runtime dev examples from 2026-06-24:
  - KR: `2975` active Yahoo KR symbol unresolved rows, including `000660`.
  - AU: `131` active Yahoo AU unresolved rows, including `ABP`, `CDX`, and `AUT`.
  - TW: `5` active FinMind unresolved rows, including `2330`, `3714`, and `2363`.
  - US: `1` active FinMind US unresolved row, `AVGO`.
- Existing provider unresolved endpoints: `apps/api/src/routes/adminRoutes.ts`
- Existing KR mappings UI: `apps/web/components/admin/AdminMarketDataKrResolver.tsx`
- Existing market data workspace UI: `apps/web/components/admin/AdminMarketDataClient.tsx`
