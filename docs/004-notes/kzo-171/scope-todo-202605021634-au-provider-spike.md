---
slug: kzo-171
source: scope-grill
created: 2026-05-02
tickets: [KZO-171]
required_reading:
  - docs/004-notes/kzo-163/transition-202604251534-provider-registry.md
  - docs/004-notes/kzo-170/transition-202605022121-us-stock-ingestion.md
  - docs/004-notes/kzo-170/scope-todo-202605020938-us-stock-ingestion.md
  - docs/market-data-platform.md
  - .claude/rules/debate-for-architectural-forks.md
superseded_by: null
---

# Todo: KZO-171 - AU Provider Spike And Decision Lock

> **For agents starting a fresh session:** read all files listed in `required_reading` above, plus the current Linear descriptions for KZO-171 and KZO-172, before starting implementation.

## Locked Decisions

- KZO-171 is a pure spike. Do not add dependencies, provider code, runtime behavior changes, schemas, workers, or committed validation scripts.
- The spike must use live validation evidence for `yahoo-finance2`; docs-only research is not enough.
- Splits are provider capability evidence only. KZO-186 owns split ingestion and replay invariant 6.
- ASX validation minimum set: BHP, CSL, VAS, WBC, AFI, plus one cited ASX-listed REIT and one cited current ASX-200 lower-market-cap constituent selected during the spike.
- If Yahoo is accepted, KZO-172 should use `providerId = "yahoo-finance-au"` and `sourceId = "yahoo-finance-au"`.
- EODHD pricing, plan names, ASX coverage, corporate-action fields, and switch triggers must be re-verified during the spike.
- Pass/fail gates: bars and catalog/metadata are hard gates; dividends are hard for BHP and VAS and best-effort elsewhere; splits are informational.
- Broad bar failure or unusable BHP/VAS dividends triggers `/debate` before locking KZO-172 around Yahoo.
- If Yahoo lacks a reliable ASX-wide catalog, KZO-172 ships bounded AU catalog support only, not full ASX autocomplete.
- KZO-172 gets a planning comment with the corrected implementation checklist, not a description rewrite.

## Implementation Steps

- [ ] Read KZO-171 and KZO-172 in Linear and confirm no newer comments supersede this locked scope.
- [ ] Create the durable spike note at `docs/004-notes/kzo-171/spike-{YYYYMMDDHHmm}-au-provider.md`.
- [ ] Capture live `yahoo-finance2` package health: latest version, publish freshness, weekly downloads, repository activity, open issue count, ASX-specific issue search, Node engine, and TypeScript type entry point.
- [ ] Validate `yahoo-finance2` API/type shape in a transient scratch context only. Do not add it to `apps/api/package.json` or commit scripts.
- [ ] Select and cite the dynamic ASX-listed REIT sample and ASX-200 lower-market-cap sample.
- [ ] Validate daily bars for BHP, CSL, VAS, WBC, AFI, the cited REIT, and the cited ASX-200 lower-market-cap sample.
- [ ] Validate dividends for the same sample set, with BHP and VAS as hard gates.
- [ ] Validate split-event capability for at least one ASX historical split case, as evidence for KZO-186 only.
- [ ] Record Yahoo failure modes and degradation guidance: provider validation errors, invalid symbols, HTTP/HTML breakage symptoms, retry/backoff recommendation, and stale-data preservation behavior.
- [ ] Lock symbol normalization guidance: internal `(ticker, marketCode)` such as `(BHP, AU)` maps to Yahoo symbol `BHP.AX` at the provider boundary and reverses before persistence.
- [ ] Determine whether Yahoo exposes a reliable ASX-wide catalog/listing source. If not, document bounded AU catalog support for KZO-172.
- [ ] Recommend the `historyStartFor("AU")` value from observed provider data; do not reuse the existing placeholder without evidence.
- [ ] Re-verify EODHD as the upgrade path: current pricing, plan names, ASX coverage, franking/DRP/BSP/rights/capital-return support, env vars likely needed, and switch triggers.
- [ ] Update `docs/market-data-platform.md` with a concise AU provider strategy summary and EODHD upgrade path.
- [ ] Add a planning comment to KZO-172 titled `Implementation checklist from KZO-171 decision lock`.
- [ ] Append the locked scope summary to KZO-171 in Linear and add a completion comment linking this todo and the spike note.

## KZO-172 Checklist Requirements

- [ ] Keep KZO-172 focused on AU bars, dividends, symbol normalization, bounded catalog/metadata, registry wiring, mock provider, and tests.
- [ ] Use `providerId = "yahoo-finance-au"` and `sourceId = "yahoo-finance-au"` if Yahoo is accepted.
- [ ] Do not add split ingestion to KZO-172; refer to KZO-186.
- [ ] Do not add provider health table/UI writes to KZO-172; refer to KZO-177. Log/source stamping is still in scope.
- [ ] Do not promise full ASX autocomplete unless KZO-171 proves a reliable ASX-wide catalog source.
- [ ] Include KZO-172 runtime validation and E2E/HTTP/API tests when that implementation ticket starts.

## Open Items

- [ ] None currently. Trigger `/debate` if Yahoo fails broad bars coverage, BHP/VAS dividends, or the personal/non-commercial deployment assumption.

## References

- Linear tickets: KZO-171, KZO-172, KZO-177, KZO-186.
- Scope-grill source: this todo.
- No debate note was produced.
