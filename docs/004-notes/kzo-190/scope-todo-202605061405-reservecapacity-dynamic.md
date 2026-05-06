---
slug: kzo-190
source: scope-grill
created: 2026-05-06
tickets: [KZO-190]
required_reading: []
superseded_by: null
---

# Todo: KZO-190 — backfillWorker `reserveCapacity` dynamic per-provider count

> **For agents starting a fresh session:** read this entire file before starting implementation. The Phase 0 codebase findings and Phase 1 decisions below are load-bearing. There is no separate debate note — scope-grill resolved without a debate.

## Background

`backfillWorker.ts:191` currently reads `provider.reserveCapacity(2 + (shouldEnrich ? 1 : 0))` (set by KZO-189). This over-reserves in two cases:

1. **Per-provider metadata cost.** When `shouldEnrich = true`, FinMind TW/US providers reserve a metadata slot they don't consume — their `fetchInstrumentMetadata` is a no-op `return null` that never calls `assertCanConsume`. Only AU's `fetchInstrumentMetadata` (a real `quote()` call) consumes a slot.
2. **`includeBars` / `includeDividends` optionality.** The hardcoded `+ 2` ignores the runtime job flags. When `includeBars=false` or `includeDividends=false` (single-dataset jobs), the formula over-reserves.

KZO-189's code comment at `backfillWorker.ts:189` explicitly delegates the includeBars/includeDividends cleanup to KZO-190.

## Locked decisions

| # | Decision |
|---|---|
| D1 | Both gaps in scope: per-provider metadata cost + bars/dividends optionality. |
| D2 | API shape: add `readonly supportsMetadataEnrichment: boolean` on `InstrumentCatalogProvider`; inline formula at the call site (not a method). |
| D3 | Place property on `InstrumentCatalogProvider` (where `fetchInstrumentMetadata` lives). Worker reads via `catalogProvider?.supportsMetadataEnrichment`. |
| D4 | Mocks mirror real counterparts. AU + AU-mock = `true`; FinMind TW/US (real + mock, all 4) = `false`. |
| D5 | Tests: worker-level truth-table (5 cells in `backfill-handler-branching.test.ts`, the KZO-189 precedent) + thin provider-level smoke (one assertion per implementation, 6 total). |
| D6 | Standalone PR; rewrite the KZO-189 worker comment block at lines 183–191. Do NOT bundle with KZO-177. |

## Final formula

```ts
// backfillWorker.ts ~line 191 (replaces `provider.reserveCapacity(2 + (shouldEnrich ? 1 : 0));`)
const catalogProvider = catalogRegistry.get(market); // hoisted from line 252
provider.reserveCapacity(
  (includeBars ? 1 : 0) +
  (includeDividends ? 1 : 0) +
  (shouldEnrich && catalogProvider?.supportsMetadataEnrichment ? 1 : 0),
);
```

The `if (shouldEnrich) { const catalogProvider = catalogRegistry.get(market); ... }` block lower in the function (currently around line 252) reuses the hoisted variable instead of re-fetching.

## Acceptance criteria

- `provider.reserveCapacity(N)` is called with `N = (bars ? 1 : 0) + (dividends ? 1 : 0) + (shouldEnrich && supportsMetadataEnrichment ? 1 : 0)`.
- All 6 catalog-provider implementations declare `supportsMetadataEnrichment` correctly.
- 5 worker-level truth-table cells assert the formula's output (see Implementation Step 8).
- 6 provider-level smoke assertions lock the boolean values.
- KZO-189 comment block (lines 183–191) rewritten to describe the new formula; stale "+1 slot harmless" and "KZO-190 tracks…" lines removed.
- No behavior change visible to users.
- Full 8-suite gate clean.

## Implementation Steps

- [x] **Step 1 — Interface field.** Add `readonly supportsMetadataEnrichment: boolean` to `InstrumentCatalogProvider` in `apps/api/src/services/market-data/types.ts`. Add JSDoc: *"True iff this provider's `fetchInstrumentMetadata` consumes a slot from the rate limiter when called. Used by `backfillWorker.ts` to right-size `reserveCapacity`. AU's Yahoo-backed `fetchInstrumentMetadata` is a real `quote()` call → true. FinMind TW/US are no-ops returning null → false."*

- [x] **Step 2 — Real provider implementations.** Set the field on:
  - `apps/api/src/services/market-data/providers/finmind.ts` (`FinMindMarketDataProvider`) → `false`
  - `apps/api/src/services/market-data/providers/finmindUsStock.ts` (`FinMindUsStockMarketDataProvider`) → `false`
  - `apps/api/src/services/market-data/providers/yahooFinanceAu.ts` (`YahooFinanceAuMarketDataProvider`) → `true`

- [x] **Step 3 — Mock provider implementations.** Set the field on:
  - `apps/api/src/services/market-data/providers/mockFinmind.ts` (`MockFinMindMarketDataProvider`) → `false`
  - `apps/api/src/services/market-data/providers/mockFinmindUsStock.ts` (`MockFinMindUsStockMarketDataProvider`) → `false`
  - `apps/api/src/services/market-data/providers/mockYahooFinanceAu.ts` (`MockYahooFinanceAuMarketDataProvider`) → `true`

- [x] **Step 4 — Hoist `catalogProvider` lookup.** In `apps/api/src/services/market-data/backfillWorker.ts`, move `const catalogProvider = catalogRegistry.get(market);` from inside the `if (shouldEnrich)` block (currently line 252) to above the `try` block (above line 182). Reuse the hoisted variable in both the formula and the enrichment block.

- [x] **Step 5 — Replace the formula.** Replace `provider.reserveCapacity(2 + (shouldEnrich ? 1 : 0));` (line 191) with the formula in the "Final formula" section above.

- [x] **Step 6 — Rewrite the KZO-189 comment block.** Lines 183–191 currently justify the over-reservation as "harmless" and delegate the cleanup to KZO-190. Rewrite to describe the new formula in terms of three independent slot decisions (bars, dividends, metadata) and add a one-line invariant note: *"`provider` and `catalogProvider` resolve to the same instance per market (per `registry.ts`), so reserving on `provider`'s rate limiter covers the metadata call's consumption on `catalogProvider`."*

- [x] **Step 7 — Test cast audit.** Run:
  ```bash
  grep -rln "as InstrumentCatalogProvider\|as unknown as InstrumentCatalogProvider\|as never" apps/api/test/
  ```
  Inspect each match. Add `supportsMetadataEnrichment: false|true` to any catalog-provider mock construction. Known candidates from Phase 1.5:
  - `apps/api/test/unit/backfill-handler-branching.test.ts` (KZO-189 precedent — most likely needed)
  - `apps/api/test/unit/catalog-sync-worker.test.ts`
  - `apps/api/test/unit/catalogSyncReschedule.test.ts`
  - `apps/api/test/integration/auStockBackfill.integration.test.ts`
  - `apps/api/test/integration/usStockBackfill.integration.test.ts`
  - `apps/api/test/integration/preProviderTruncation.integration.test.ts`
  - `apps/api/test/integration/backfill-old-shape-rejection.integration.test.ts`

  The other matches (`fx-refresh-worker`, `upserts-dividend-currency`, `registerAnonymousShareTokenPurgeWorker`) likely don't construct catalog providers but require a 30-second visual check.

- [x] **Step 8 — Worker-level truth-table tests** in `apps/api/test/unit/backfill-handler-branching.test.ts`. Spy on `provider.reserveCapacity` and assert N for these 5 cells:

  | Case | `supportsMetadataEnrichment` | `includeBars` | `includeDividends` | `shouldEnrich` | Expected N |
  |---|---|---|---|---|---|
  | AU enrich both | true | T | T | T | 3 |
  | TW enrich both (over-reserve fix) | false | T | T | T | 2 |
  | AU no-enrich both (KZO-189 path retained) | true | T | T | F | 2 |
  | TW bars-only enrich | false | T | F | T | 1 |
  | TW dividends-only no-enrich | false | F | T | F | 1 |

  Use the KZO-189 precedent's deps factory shape; do NOT introduce a new test file.

- [x] **Step 9 — Provider-level smoke tests.** Add ~6 assertions (one per implementation) in either an existing provider unit test file or a small new file (`apps/api/test/unit/provider-metadata-enrichment-flag.test.ts`). Each assertion: `expect(new ProviderClass(...).supportsMetadataEnrichment).toBe(<expected>)`. Cheap insurance against silent boolean drift.

- [x] **Step 10 — Run the full 8-suite gate** per `.claude/rules/full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
  Result: Suites 1-6, 8 clean. Suite 7 reported 2 failures in `transactions-card-reorder-aaa.spec.ts` ([transactions-B], [transactions-C]) — both `/__e2e/oauth-session: 429 rate_limit_exceeded`, the pre-existing OAuth-shared-user rate-limit cascade (3rd occurrence: KZO-189 → KZO-190 team-run → KZO-190 user-run). All 3 specs pass cleanly in isolation (`npx playwright test … specs-oauth/transactions-card-reorder-aaa.spec.ts` → 3 passed in 18.4s). Architect's 5-point non-regression ruling stands: file predates this ticket, zero diff overlap with OAuth/seed paths, identical 429 signature across runs, no production code changes affecting OAuth. Follow-up ticket recommended for `/__e2e/oauth-session` rate-limit budget tuning + shared-OAuth-user isolation (also flagged in PR Risk/Rollback section).

- [x] **Step 11 — PR description.** Follow `docs/git-pr-flow.md` § 3-4 sectioning (`## Problem` / `## Solution` / `## Testing` with `Evidence:` block / `## Risk/Rollback`). Per `.claude/rules/pr-bound-docs-review-compliance.md`, `pr-gate.yml` enforces these — submitting without them fails CI.

## Out of scope (do NOT expand)

- **`searchInstruments` symmetry.** This `InstrumentCatalogProvider` method is also a no-op for TW/US, but it's called from the `/market-data/search` route, not the backfill worker. Different rate-limit handling (route catches `RateLimitedError` → 503 + Retry-After). KZO-190 is scoped to the worker only.
- **KZO-177 bundling.** Ticket suggested bundling with provider-health work; D6 explicitly chose standalone.
- **Frozen note edits.** `docs/004-notes/kzo-172/*` and `docs/004-notes/kzo-189/*` reference the old formulas. Per `.claude/rules/doc-management.md`, frozen notes are immutable post-merge. Do NOT update them.

## Open Items

None.

## References

- Source: `apps/api/src/services/market-data/backfillWorker.ts:182-194` (formula + comment block)
- Source: `apps/api/src/services/market-data/types.ts:136-165` (InstrumentCatalogProvider interface)
- Source: `apps/api/src/services/market-data/registry.ts:42, 87` (rate-limiter wiring; same-instance-per-market invariant)
- Source: `apps/api/src/services/market-data/providers/{finmind,finmindUsStock,yahooFinanceAu,mockFinmind,mockFinmindUsStock,mockYahooFinanceAu}.ts`
- Test precedent: `apps/api/test/unit/backfill-handler-branching.test.ts` (KZO-189)
- Prior context (frozen, do not edit): `docs/004-notes/kzo-189/transition-202605061930-metadata-enrichment-gate.md`, `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md`
- Rules consulted: `.claude/rules/interface-caller-verification.md` (test-cast audit pattern), `.claude/rules/full-test-suite.md`, `.claude/rules/doc-management.md`, `.claude/rules/pr-bound-docs-review-compliance.md`
- Linear ticket: KZO-190
