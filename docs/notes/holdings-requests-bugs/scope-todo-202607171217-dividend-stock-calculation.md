---
slug: dividend-stock-calculation
source: scope-grill
created: 2026-07-17
tickets: []
required_reading:
  - docs/notes/holdings-requests-bugs/scope-todo-202607160920-holdings-requests-bugs.md
superseded_by: null
---

# Todo: Dividend Stock Calculation And Review Hero

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

This scope supersedes only the dividend stock-calculation and stock-variance behavior in the prior holdings scope where the two documents conflict. The deliberately posted 2886 receipt of 150 shares is test data and must not be modified.

## Locked Decisions

- Configure an optional account-market fallback **par value**, not a fixed dividend ratio. Store it by `(accountId, marketCode)`, leave it unset initially, and enable par-value derivation for TW only in this revision.
- A fallback par value only prefills an event calculation. The user must explicitly confirm its use for each dividend event; bulk confirmation is out of scope.
- Support three calculation methods: an automatically usable authoritative provider ratio, derivation from a selected par value, and a custom direct ratio. Do not add ratio presets.
- Permit an account-event override of authoritative provider data while retaining the original value, source, unit, and calculation provenance. User-derived methods require confirmation; authoritative provider ratios do not.
- Normalize provider amount semantics as value, unit, source, and dataset. Enable par-value derivation only when the unit is compatible. Unknown-unit values remain visible but cannot be used automatically.
- Backfill `TWD_PER_SHARE` only for existing TW rows with confirmed FinMind `TaiwanStockDividend` provenance. Do not blanket-label all historical TW values.
- Calculate `ratio = provider stock-dividend value / selected par value`, then show theoretical entitlement, floor expected shares to a whole quantity, and expose the fractional remainder. Cash-in-lieu remains a separate actual field.
- Validate finite positive par values and direct ratios with sufficient decimal precision. Do not impose an arbitrary financial cap; require an additional confirmation for ratios above `1.0` and reject quantities outside supported numeric limits.
- Display provider value, unit, source, dataset, selected method, par value, ratio, theoretical shares, expected whole shares, and fractional remainder in event-level calculation surfaces.
- Event-level calculation surfaces are the dividend posting/edit modal, Dividend Review drawer, and Overview event editor. Do not add raw provider values to the Review hero or table.
- Rename the expected card's incorrect `Received stock qty` label to `Expected stock`. Always render stock calculation details for `STOCK` and `CASH_AND_STOCK` events, including zero-receipt and expected-only rows.
- Allow factual stock receipts to be posted when expected stock is unavailable. Preserve received cash, received shares, position actions, cost basis, and portfolio quantities independently from expected calculations.
- Never render an unresolved expected quantity as zero. Show `Expected shares unavailable` or an em dash, keep stock variance unavailable, and retain the actionable calculation state.
- Keep cash reconciliation, stock calculation, and stock reconciliation separate. Stock reconciliation states are `needs_calculation`, `pending_receipt`, `matched`, `variance`, and `explained`, with an independent explanation note.
- Split Review filtering into Cash status and Stock status. Persist both filters in the URL and apply them consistently to rows, counts, and hero aggregates.
- Preserve existing reconciliation values as cash status during migration. Derive historical stock state conservatively without inferring stock review from a combined Matched or Explained status, and retain original status metadata for audit.
- Store versioned account-event calculation records outside global market data. Posting snapshots the active calculation; subsequent expectation-only corrections create append-only versions linked to the previous calculation and ledger.
- Expectation-only amendments may update expected ratio, par value, expected shares, stock variance, and attention state. They must not rewrite the original ledger, cash receipts, received shares, position actions, cost basis, or portfolio history.
- Account fallback changes are prospective. Unconfirmed previews use the latest fallback; confirmed and posted calculations remain pinned until explicitly reset or amended.
- Detect provider value, unit, or authoritative-ratio drift after confirmation. Preserve the selected calculation, show old and new provider values, and require explicit reconfirmation before switching.
- Permit clearing the account fallback and resetting an unposted calculation to Needs calculation. Retain prior versions and audit history. Posted corrections use expectation-only amendment versions.
- Permit calculation confirmation without posting a receipt. When a calculation and receipt are submitted together, commit both atomically; posting a receipt without a calculation remains valid and leaves stock state at Needs calculation.
- Extend Dividend Review hero aggregates over the complete filtered result, independent of pagination. Respect date, ticker, market, account, cash status, stock status, posting, and existing source-composition filters.
- Group expected and received stock by market and ticker; never sum shares from different securities into one quantity. For mixed states, show known expected shares and unresolved-event counts separately.
- Enrich Total Expected with expected stock summaries and calculation-needed counts. Enrich Total Received with factual received-stock summaries.
- Show at most three ticker summaries per hero card, ordered deterministically, followed by a keyboard-accessible `+N more` control that opens the complete filtered breakdown.
- Rename the hero's Variance card to Cash Variance. Replace Open Items with a de-duplicated Needs Attention count plus Cash reconciliation and Stock calculation/reconciliation breakdowns.
- Add Dividend calculation defaults inside the expandable `/settings/accounts` account card, separate from fee profiles. Show the account market, optional TW par value, and a clear shares-calculation example.
- From an event calculation surface, deep-link to the exact account-market settings section in a new tab. Query parameters must focus and expand the account card and section; returning focus to the dividend tab refreshes the setting without losing unsaved receipt input.
- Viewing provider values and provenance follows dividend read access. Confirming or amending an event calculation requires dividend write access. Editing account-market defaults requires account-management permission; otherwise show the value read-only without an edit link.
- If an unused account changes market, clear an incompatible fallback rather than carrying it to the new market.
- Support loading, empty, partial-data, error, keyboard, screen-reader, mobile, tablet, and desktop states for new settings, modal, filter, and hero controls.

## Out Of Scope

- Fixed or configurable ratio presets.
- Bulk event calculation confirmation.
- Account-market par-value derivation outside TW.
- Automatic rewriting of confirmed calculations, posted expectations, or accounting facts.
- A broader Dividend Overview redesign.
- Moving dividend defaults into fee profiles.
- Changing the deliberately posted 2886 receipt of 150 shares.

## Implementation Steps

- [x] Add append-only migrations for account-market dividend settings, versioned account-event calculations, calculation provenance/unit snapshots, stock reconciliation state and note, historical status audit metadata, and the indexes/constraints needed by filtered Review reads.
- [x] Add a provenance-gated data migration that marks only confirmed FinMind TW `TaiwanStockDividend` raw amounts as `TWD_PER_SHARE`, leaving unknown sources and units unresolved.
- [x] Extend shared contracts with account-market dividend settings, normalized provider value metadata, calculation methods/versions, theoretical and whole-share quantities, fractional remainder, stock reconciliation, drift details, and ticker-level hero aggregates.
- [x] Implement memory and Postgres persistence parity for account-market settings, calculation version chains, latest-active calculation resolution, expectation-only amendments, stock explanation notes, and audit attribution.
- [x] Update the FinMind provider adapter and market-data upsert path to emit explicit source, dataset, and unit metadata without overwriting repaired or user-confirmed calculations.
- [x] Build pure domain calculation helpers for provider, par-value-derived, and direct-ratio methods, including decimal validation, high-ratio confirmation, floor behavior, fractional remainder, and numeric-overflow protection.
- [x] Add account-market dividend-settings read/PATCH endpoints with account ownership, market compatibility, delegated account-management authorization, optimistic version handling, audit events, and narrow cache invalidation.
- [x] Add calculation preview/confirm/reset endpoints and an expectation-only amendment endpoint. Enforce dividend-write authorization, append-only versions, provider-drift checks, idempotency/optimistic concurrency, and atomic confirm-plus-post behavior.
- [x] Keep receipt posting valid without a confirmed calculation. Snapshot an active provider or confirmed user calculation when present without changing received-stock posting, position-action, cost-basis, or portfolio recomputation semantics.
- [x] Migrate existing combined reconciliation values to cash status and conservatively derive stock state. Preserve the original status for audit and ensure unresolved posted rows such as 2886 remain Needs calculation with unavailable variance.
- [x] Update Review normalized SQL/read models to overlay the latest calculation version, avoid unresolved-as-zero semantics, calculate stock variance only when expected shares are known, and support separate cash/stock status filters.
- [x] Extend Review enrichment SQL and memory aggregation with filter-aware expected/received stock quantities, unresolved counts, de-duplicated attention counts, and deterministic ticker ordering across the full filtered set rather than the current page.
- [x] Add Dividend calculation defaults to the account settings card with unset/read-only/editing states, ratio examples, permission handling, narrow save errors, and stable focus anchors.
- [x] Add the account/market/section deep-link builder and query handling that expands, scrolls to, and focuses the settings section in a new tab; refresh settings on return without discarding modal state.
- [x] Rework event calculation UI in the posting/edit form and Review drawer: correct labels, always-visible stock details, raw provider metadata, method selection, editable par value, custom ratio, preview, confirmation, reset, drift warning, and high-ratio warning.
- [x] Add separate stock-calculation and stock-reconciliation presentation/actions, including independent explanation notes and posted expectation-only amendment history.
- [x] Split Review Cash status and Stock status filters, preserve both in URL state, and update deep links, reset behavior, loading states, and accessible labels.
- [x] Enrich Total Expected and Total Received hero cards with known/unresolved ticker summaries and an accessible full-breakdown interaction; rename Cash Variance and replace Open Items with Needs Attention plus breakdowns.
- [x] Add shared-type, domain, provider, service, route, memory, and Postgres tests covering unit gating, calculations, drift, versioning, permissions, status migration, atomic posting, posted expectation amendments, and persistence parity.
- [x] Add web service, hook, component, responsive, accessibility, and URL-state tests covering settings deep links, modal calculations, unresolved values, 2886's retained 150-share receipt, hero filtering, mixed expected states, overflow breakdowns, and separate status filters.
- [x] Run `/aaa` to add or update E2E tests for the new account-settings form, new-tab deep link, calculation confirmation, posting without expectation, atomic confirm-plus-post, posted expectation amendment, filter-responsive hero, and mobile/desktop Review flows.
- [x] Run the smallest relevant checks first, then all eight repository-required suites before declaring full validation.
- [x] Revisit this file after implementation and mark only delivered steps with `- [x]`; leave undelivered scope visible for follow-up.

## Open Items

- [x] No product-scope items remain.

## Mockups

- Source: `docs/notes/holdings-requests-bugs/mockups/dividend-stock-calculation-mockups.html`
- Filter-responsive Dividend Review hero and records table: `docs/notes/holdings-requests-bugs/mockups/09-dividend-review-hero.png`
- Event calculation drawer with provider provenance and preserved receipt facts: `docs/notes/holdings-requests-bugs/mockups/10-dividend-calculation-drawer.png`
- Focused account-market dividend settings deep link: `docs/notes/holdings-requests-bugs/mockups/11-account-market-dividend-settings.png`
- Mobile Dividend Review hero and stock record: `docs/notes/holdings-requests-bugs/mockups/12-dividend-review-mobile.png`
- Validated desktop implementation with retained 2886 receipt: `docs/notes/holdings-requests-bugs/mockups/13-dividend-review-implementation-desktop.png`
- Validated mobile implementation with filter-responsive stock totals: `docs/notes/holdings-requests-bugs/mockups/14-dividend-review-implementation-mobile.png`

## References

- Prior dividend scope: `docs/notes/holdings-requests-bugs/scope-todo-202607160920-holdings-requests-bugs.md`
- Dividend Review: `apps/web/components/dividends/DividendReviewClient.tsx`
- Review drawer: `apps/web/components/dividends/DividendReviewDrawer.tsx`
- Dividend posting/edit form: `apps/web/components/dividends/DividendPostingForm.tsx`
- Dividend Overview: `apps/web/components/dividends/DividendCalendarClient.tsx`
- Account settings route: `apps/web/components/settings/AccountsSettingsClient.tsx`
- Account settings cards: `apps/web/features/settings/components/AccountsListSection.tsx`
- Shared contracts: `libs/shared-types/src/index.ts`
- Postgres dividend read models: `apps/api/src/persistence/postgres.ts`
- FinMind adapter: `apps/api/src/services/market-data/providers/finmind.ts`
- Stock-ratio repair baseline: `db/migrations/103_dividend_stock_ratio_repair_and_preview.sql`
- TWSE ratio definition: `https://www.twse.com.tw/en/announcement/ex-right/twt48u.html`
- Taiwan Company Act Article 156: `https://law.moea.gov.tw/EngLawContent.aspx?id=10053&lan=E`
- Scope debate note: none
- Linear tickets: none provided
