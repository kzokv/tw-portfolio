---
slug: holdings-requests-bugs
source: scope-grill
created: 2026-07-16
tickets: []
required_reading:
  - docs/notes/holdings-requests-bugs/scope-todo-202607160920-holdings-requests-bugs.md
superseded_by: null
---

# Todo: Posted Transaction MCP Mutation Revision

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This is an additive revision; the holdings, fees, transaction totals, ticker details, and dividend work in the prior todo remains in scope.

## Locked Decisions

- Add MCP support for updating and deleting posted transactions. The current MCP catalog can read posted transactions and mutate drafts but cannot mutate confirmed trade events.
- Target every mutation by explicit immutable transaction ID. AI resolves IDs through `get_recent_transactions`; mutation tools never execute rule-based queries such as deleting every matching ticker before a date.
- Ordinary update keeps account, ticker, market, and currency identity unchanged. Correcting those fields requires a future atomic replacement workflow and is outside this revision.
- Editable fields are trade date, quantity, unit price, BUY/SELL side, day-trade status, commission, and tax. `isDayTrade=true` is valid only for SELL; changing side to BUY clears it. Trade timestamp and booking sequence remain server-managed.
- Expose six model-facing tools: `preview_update_posted_transactions`, `update_posted_transactions`, `preview_delete_posted_transactions`, `delete_posted_transactions`, `get_posted_transaction_mutation_preview`, and `get_posted_transaction_mutation_run`.
- The plural update/delete tools accept one or many explicit transactions. Updates and deletions remain separate operation types; mixed batches are not allowed.
- Batch mutations are all-or-nothing. Apply every update/deletion to one simulation before replay, reject duplicate IDs/no-op/conflicting patches, replay scopes deterministically, and commit nothing if any item is invalid, stale, unauthorized, or creates invalid inventory.
- Permit multi-account batches only within one explicitly selected owner/portfolio context. Acquire locks in deterministic account-ID order and revision/fingerprint every affected account without revealing cross-tenant resource existence.
- Add `postedTransactionMutationBatchLimit` to AI Connector admin policy. It is a positive integer, defaults to 50 for existing and new deployments, and has no application hard cap.
- The admin field has an info tooltip and conditional inline warning above 200. Warn about MCP payload/response failures, preview/client timeouts, longer locks and revision conflicts, rebuild queue backlog, and client timeout after server commit. Saving remains allowed.
- Connector policy/status responses expose the configured mutation limit so clients can split requests before preview.
- Require one batch-level correction reason. Each item may include an optional note; every item audit stores the batch reason, optional note, and before/after facts.
- Preview and confirmation are separate for both update and deletion. Confirmation requires the server-owned preview ID/version, accounting fingerprint, exact confirmation summary/digest, and explicit post-preview user approval.
- The original imperative request does not count as post-preview confirmation. Preview tool copy must direct the AI to present impact and wait for explicit approval.
- Previews expire after 30 minutes. Expired previews remain read-only audit records but cannot be confirmed. Accounting or account-revision drift invalidates confirmation immediately.
- Persist the complete preview server-side. Initial preview responses return aggregate impact, warnings, and the first 50 item results; `get_posted_transaction_mutation_preview` provides paginated full inspection.
- Add a read-only responsive Transactions preview page showing reason, expiry/staleness, before/after item facts, affected holdings/cash/lots/realized P&L/dividends/snapshots, blockers, manual receipt re-entry warnings, and pagination plus account/ticker/status filters. Confirmation remains in the AI conversation for this revision.
- Confirmation is idempotent by preview ID and digest. An identical retry returns the original result; conflicting reuse is rejected.
- Confirmation returns only after transaction facts and core accounting are atomically consistent: quantities, cost basis, lots, allocations, realized P&L, settlement cash, and dividend expectations/actual effects.
- For each affected account/ticker/market, snapshot regeneration begins at the earliest old, new, or deleted trade date across the batch.
- Persist a durable mutation rebuild run/outbox record atomically with core accounting. Reuse the replay worker infrastructure for holding/wallet snapshots with bounded retries and per-scope queued/running/completed/partially-failed/failed status.
- `get_posted_transaction_mutation_run` returns core commit status, rebuild status, affected scopes, timestamps, failure reasons, before/after summary, and deep links. AI must not report full completion while rebuild work remains pending.
- After rebuild retries are exhausted, preserve consistent core accounting and direct AI to the existing preview/replay portfolio tools for explicit recovery. Do not add a mutation-specific retry tool in this revision.
- For `CALCULATED` trades, quantity, price, side, or day-trade changes recalculate commission/tax from the transaction's booked fee-policy snapshot.
- For `MANUAL` or `SOURCE_PROVIDED` fees, preserve amounts/provenance unless the request explicitly supplies replacement amounts or selects recalculation. Explicit amounts set source to `MANUAL`. Never substitute the account's current profile implicitly.
- Update preview shows before/after fees, provenance, settlement cash, inventory, P&L, and dividend effects.
- Transaction updates recalculate dividend eligibility and expected cash/stock entitlements, create/update/retire unposted expectations, preserve posted actual receipts/deductions/received stock, and reopen reconciliation when expectations change.
- Transaction deletion reuses the existing destructive preview model. It may purge affected dividend expectations/postings/cash/stock actions after explicit confirmation and must enumerate manual receipt re-entry requirements. Failure preserves original transaction and dividend state.
- Reuse `transaction:write` for posted mutation. Delegated shared-portfolio confirmation additionally requires `dividend:write` when the rewrite can purge or replace dividend artifacts. Owners retain current owner-write semantics.
- Update OAuth/connector consent copy to describe posting, updating, and deleting confirmed transactions. Add individual advanced-tool toggles and keep all tools behind deployment write-group policy, OAuth/share authorization, rate limiting, and delegated audit.
- Extract one canonical posted-transaction mutation service and migrate the current web/API edit flow to preview/confirm plus atomic replay. No compatibility path may retain persist-before-replay behavior.
- Existing single-transaction web edit/delete flows use the canonical preview service and confirmation UI. Bulk authoring controls in the web app remain out of scope; the new web batch page is inspection-only.
- Updating a transaction posted from an AI draft preserves its confirmed row/link. Deleting it never reopens or reposts the draft row; the immutable row displays `Posted transaction deleted`, while audit lineage retains original batch/row/transaction IDs.
- Permanent transaction deletion remains the canonical behavior; retain metadata-only audit rather than a soft-deleted financial payload.
- Mutation completion invalidates relevant read caches and publishes transaction, holdings, dividend, and rebuild-status events.

## Implementation Steps

- [x] Add shared MCP input/output contracts for explicit-ID update/delete items, batch reasons/notes, preview pages, confirmations, before/after facts, affected accounting/dividend summaries, and mutation-run status.
- [x] Add persistence contracts and migrations for posted-transaction mutation previews, item impacts, idempotent confirmation results, account revisions/fingerprints, durable rebuild runs/scopes, audit lineage, and deleted confirmed-draft status.
- [x] Add `postedTransactionMutationBatchLimit` to AI Connector admin policy with default 50, positive-integer validation, policy/status exposure, persistence parity, and no application hard cap.
- [x] Add the admin settings control with an info tooltip and conditional inline warning above 200, including localized examples of payload, timeout, locking, queue, and post-commit client-timeout risks.
- [x] Extract a canonical mutation simulation service that loads all explicit IDs under one portfolio, rejects duplicates/no-ops/conflicts, applies the complete batch to a clone, replays affected scopes once in deterministic order, and calculates the earliest snapshot rebuild date per scope.
- [x] Implement same-identity update validation for date, quantity, unit price, side, day-trade status, commission, and tax while keeping timestamp/sequence/identity fields immutable.
- [x] Implement booked-snapshot fee recalculation and protected manual/source-provided fee behavior, including BUY/SELL/day-trade transitions and before/after fee/provenance/settlement preview facts.
- [x] Extend dividend reconciliation during update to change expected entitlements nondestructively, preserve posted actuals, reopen changed reconciliation, and expose affected dividend/variance facts.
- [x] Generalize the existing destructive transaction-deletion simulation to explicit-ID batches while retaining affected-dividend purge, manual receipt re-entry, negative-inventory blocking, atomic rollback, and metadata-only audit behavior.
- [x] Implement deterministic multi-account locking, per-account revision/fingerprint checks, tenant-hiding authorization failures, and one atomic accounting commit across all affected scopes.
- [x] Persist preview/item data for 30 minutes with aggregate plus first-50 responses and paginated `get_posted_transaction_mutation_preview` reads.
- [x] Implement idempotent update/delete confirmation that validates exact summary/digest, preview version, actor/owner context, operation type, account revisions, and item set before returning an existing or newly committed result.
- [x] Persist a mutation rebuild outbox/run atomically with core accounting, enqueue it through the replay worker infrastructure, add bounded retries, and expose per-scope mutation-run status.
- [x] Add the six MCP definitions, risk annotations, strict schemas, explicit portfolio selector requirement, dispatch/service handlers, deep links, and structured errors.
- [x] Mark delete as destructive and update as bounded write; add tool-specific policy overrides, deployment write-group checks, rate limits, `transaction:write`, and conditional delegated `dividend:write` enforcement.
- [x] Update OAuth consent, connector settings, share-capability copy, and advanced tool controls to describe and expose posted update/delete accurately.
- [x] Add the read-only responsive transaction mutation preview route/page with aggregate warnings, filters, paginated item impacts, expiry/stale states, and manual dividend receipt re-entry details.
- [x] Migrate the existing web/API posted edit flow from direct PATCH plus asynchronous replay to canonical preview/confirmation and atomic core accounting; preserve responsive single-edit UX and recompute status feedback.
- [x] Preserve AI draft confirmed state on update, add deleted-posted status/lineage on deletion, and prevent reopening or reposting historical draft rows.
- [x] Invalidate affected route/read caches and publish transaction, holdings, dividend, audit, and durable rebuild lifecycle events after commit.
- [x] Add focused unit tests for schemas, field validation, fee provenance, day-trade transitions, duplicate/no-op batches, preview digesting, expiry, idempotency, admin warning thresholds, and tool annotations.
- [x] Add memory and Postgres integration tests for single/bulk update/delete, combined simulation, weighted-average and realized-P&L replay, dividend expectation/actual behavior, cross-account atomicity, stale revisions, rollback, lineage, and persistence parity.
- [x] Add MCP HTTP/OAuth/share tests for explicit-ID lookup/mutation, post-preview confirmation, tool toggles, transaction/dividend capabilities, tenant isolation, rate limits, pagination, no-hard-cap configured behavior, and structured oversized/timeout failures.
- [x] Add worker tests for durable enqueue, restart recovery, retries, partial scope failure, status reporting, and explicit replay recovery after exhaustion.
- [x] Add responsive web component and E2E coverage for single update/delete confirmation, large preview inspection, expiry/staleness, admin limit warnings, recompute status, rollback errors, and deleted AI draft lineage.
- [x] Run `/aaa` to add or update E2E tests covering posted transaction MCP update/delete and the revised web mutation flow.
- [x] Run the smallest relevant test scopes first, then complete all eight repository-required suites before declaring full validation.
- [x] Revisit this file and the required prior todo after implementation; mark only delivered steps with `- [x]` and leave undelivered scope visible.

## Open Items

- [x] No product-scope items remain. The user-approved no-ticket path uses `waiver:linear-ticket`, `Approved-by: @kzokv`, and `Scope: both` for commit and PR naming.

## References

- Prior locked scope: `docs/notes/holdings-requests-bugs/scope-todo-202607160920-holdings-requests-bugs.md`
- MCP tool catalog and annotations: `apps/api/src/mcp/tools.ts`
- MCP dispatch and explicit portfolio selection: `apps/api/src/mcp/registerMcpRoutes.ts`
- MCP policy and scopes: `apps/api/src/mcp/policy.ts`, `apps/api/src/services/mcpConnectorLifecycle.ts`
- Posted transaction read tool: `apps/api/src/services/mcpPortfolioRead.ts`
- Current transaction mutation routes: `apps/api/src/routes/registerRoutes.ts`
- Replay and snapshot scheduling: `apps/api/src/services/replayPositionHistory.ts`
- Destructive preview and atomic deletion: `apps/api/src/services/dividendDestructivePreview.ts`
- Existing durable MCP replay worker: `apps/api/src/services/mcpPortfolioMaintenance.ts`, `apps/api/src/services/mcpReplayPositionRunWorker.ts`
- AI draft lifecycle: `apps/api/src/services/mcpDrafts.ts`
- Connector settings and consent UI: `apps/web/components/settings/AiConnectorsSettingsClient.tsx`, `apps/web/components/connectors/ChatGptConnectorAuthorizeClient.tsx`
- Transaction web mutation service: `apps/web/features/portfolio/services/transactionMutationService.ts`
- Existing integration coverage: `apps/api/test/integration/transaction-mutations.integration.test.ts`, `apps/api/test/integration/mcp.integration.test.ts`
- Validation evidence: `docs/notes/holdings-requests-bugs/validation-evidence-20260716.md`
- Historical deferred capability note: `docs/004-notes/ai-copilot-transaction-inbox/grill-wrap-up.md`
- Scope debate note: none
- Linear tickets: none provided
