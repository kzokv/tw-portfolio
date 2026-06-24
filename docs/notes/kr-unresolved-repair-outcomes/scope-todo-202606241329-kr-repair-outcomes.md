---
slug: kr-unresolved-repair-outcomes
source: scope-grill
created: 2026-06-24
tickets: []
required_reading: []
superseded_by: null
---

# Todo: KR Unresolved Repair Outcomes

> **For agents starting a fresh session:** this todo was produced by a scope-grill session after inspecting dev data for KR unresolved symbol `351870`. The incident showed operation `44164f28-4f7c-44ce-bcc9-2b7af40df27c` completed with `applied=0 skipped=1 scanned=1`; the unresolved row correctly remained active because the candidate `351870.KS` was rejected and no durable mapping was written.

## Locked Scope

- [x] Keep operation `phase=completed` for a finished runner, but add an aggregate result status so zero-applied repairs are shown as warning/no-op, not success.
- [x] For Yahoo KR repair execution, try the catalog-derived suffix first, then the alternate KR suffix when the first candidate is rejected.
- [x] Respect existing provider pacing/rate-limit behavior. If an alternate candidate hits rate limit, record `rate_limited`/pause behavior, not `candidate_rejected`.
- [x] Extend outcome evidence JSON with structured verification detail: `verificationStatus`, `verificationReason`, and `attemptedCandidates`.
- [x] Keep preview provisional and cheap; do not automatically verify candidates in preview.
- [x] After execute, show an honest immediate "execution started" notification. Terminal results come from operation history, inspector, and unresolved row context.
- [x] Operation history rows show aggregate outcome summary, for example `Completed - 0 mapped - 1 skipped`.
- [x] Operation inspector shows attempted candidates and rejection reasons clearly.
- [x] Unresolved listing API attaches `latestOperationOutcome` server-side; UI renders it for KR unresolved mapping rows first.
- [x] If a durable mapping already exists during repair execution, resolve the unresolved row with a `mapping_already_exists` succeeded outcome.
- [x] Do not add manual mapping override in this fix.
- [x] Do not add data migration or cleanup in this fix.
- [x] Cover with focused API integration tests plus web unit tests; no E2E unless implementation adds a new full browser flow.

## Implementation Steps

- [x] Add a provider-side KR candidate verification helper that can try ordered candidates: catalog hint first, alternate suffix second.
- [x] Update repair execution to persist attempted candidate evidence and only mark `candidate_rejected` after all non-rate-limited attempts fail.
- [x] Preserve rate-limit semantics when any candidate attempt hits the provider budget/upstream limit.
- [x] Add existing durable-mapping reconciliation inside repair execution.
- [x] Add operation outcome aggregate summary to normalized market/provider operation responses.
- [x] Add `latestOperationOutcome` to unresolved listing rows, backed by a server-side query/helper.
- [x] Update operation history and inspector UI to show aggregate result, attempted candidates, and rejection reasons.
- [x] Update KR unresolved row UI to show latest repair outcome for active rows.
- [x] Update execute notification copy to say execution started, not success.
- [x] Add API integration tests for alternate suffix success, all-candidates rejected, rate-limited alternate attempt, and existing mapping reconciliation.
- [x] Add web tests for operation row summary, inspector evidence, and unresolved-row latest outcome.

## Out Of Scope

- [ ] Manual mapping override.
- [ ] Automatic data migration or cleanup for historical unresolved rows.
- [ ] Preview-time Yahoo verification.
- [ ] Full generic UX copy for every non-KR provider.

## Open Items

- [ ] Consider a future manual mapping override flow with typed confirmation, explicit attempted-candidate history, audit evidence, and strict copy around force mapping.
- [ ] Consider a future explicit admin cleanup/reconcile operation for historical unresolved rows that already have durable mappings.

## References

- Dev incident symbol: `351870`
- Latest inspected operation: `44164f28-4f7c-44ce-bcc9-2b7af40df27c`
- Key backend code: `apps/api/src/routes/adminRoutes.ts`
- KR suffix hint code: `apps/api/src/services/market-data/providers/twelveDataKr.ts`
- Yahoo KR verification code: `apps/api/src/services/market-data/providers/yahooFinanceKr.ts`
