---
slug: mcp-account-tools-ui-fee-edit
source: scope-grill
created: 2026-05-31
tickets: []
required_reading: []
superseded_by: null
---

# Todo: MCP account tools, ChatGPT components, account-name UI, and fee editing

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Account MCP tools include list/create/update/soft-delete/restore. Permanent account purge is out of scope.
- Add a distinct `account:manage` MCP/OAuth scope and map it to the existing write policy group for this pass.
- Build two ChatGPT Apps components: an account manager component and an enhanced transaction draft component.
- Draft/account UI shows account names to users and submits account IDs internally.
- Add deterministic server-computed draft posting preview for account confirmation, gross value, commission, tax, net cash impact, fee source, and operational warnings.
- Allow explicit zero commission/tax overrides. Omitted fee fields still mean calculated fees.
- Suggestions are limited to operational and data-quality guidance; investment, tax, suitability, target-price, buy/sell/hold, and rebalancing advice remain out of scope.
- Add `accountName` to transaction-facing DTOs and replace visible account IDs in user-facing app read views.
- Posted transaction edit supports commission/tax edits in the existing inline edit row. Fee edits set `feesSource = "MANUAL"` and trigger replay/recompute.
- Fee-profile CRUD is out of scope.

## Implementation Steps

- [x] Add shared DTO/types for account-management widget state, account display metadata, posting preview rows/groups, and `accountName` on transaction-facing records.
- [x] Add `account:manage` to shared MCP scope types, supported OAuth metadata, connector consent labels, policy tests, and lifecycle scope-group mapping.
- [x] Implement account MCP service functions for list/create/update/soft-delete/restore using existing account route semantics; keep post-create currency changes and purge unavailable over MCP.
- [x] Register account MCP tools in `apps/api/src/mcp/tools.ts` and `apps/api/src/mcp/registerMcpRoutes.ts`, including `get_account_manager_component` with ChatGPT Apps metadata.
- [x] Add account-name resolution helpers for MCP text callers: resolve only unique active account names, otherwise block with candidate account names.
- [x] Add `get_transaction_draft_posting_preview` that reuses deterministic server validation and fee calculation rules before `post_transaction_draft_rows`.
- [x] Extend draft row update/preflight handling so commission and tax can be explicitly set to `0`, omitted values remain calculated, and fee-source/warning metadata is visible.
- [x] Extend `get_transaction_draft_batch_component` widget payload with active account selector data, account names, preview summary, fee-source labels, and operational suggestions.
- [x] Update `ChatGptTransactionDraftWidget` to select accounts by name, edit commission/tax, show posting preview, and post selected ready rows after confirmation.
- [x] Build `ChatGptAccountManagerWidget`, route it at `/connectors/chatgpt/account-manager`, and add a local harness mirroring the existing transaction-draft widget harness.
- [x] Add `accountName` to transaction history mappers in API routes and ticker details services, with an explicit missing/deleted account fallback.
- [x] Replace raw account IDs with account names in user-facing read views: dashboard summary/details, recent transactions card, transaction history table, edit row display, AI inbox, ChatGPT widgets, and cash-ledger trade detail surfaces where account identity is shown.
- [x] Preserve account IDs for routing, query params, API payloads, test selectors where identity matters, audit/log metadata, and internal state.
- [x] Extend `PATCH /portfolio/transactions/:tradeEventId` to accept nonnegative integer `commissionAmount` and `taxAmount`; changed fee fields set `feesSource = "MANUAL"`.
- [x] Ensure explicit fee fields win when submitted together with quantity/price changes, avoiding the fee-recalculation prompt in that case.
- [x] Update posted transaction inline edit UI to include commission and tax inputs on desktop and mobile; inputs must accept `0`.
- [x] Update transaction mutation hook/service types so fee edits are submitted and recompute/replay state behaves like existing posted transaction edits.
- [x] Add backend tests for account MCP authorization, account CRUD tools, posting preview, zero-fee overrides, fee-difference warnings, account-name ambiguity, and posted fee edit persistence/recompute scheduling.
- [x] Add web unit/component tests for account-name rendering, ChatGPT account manager state, draft widget account-name selection, zero-fee edit handling, and posted transaction fee edit inputs.
- [x] Update E2E tests covering the MCP/UI account-manager flow, transaction draft posting preview, account-name display, and posted transaction commission/tax editing.
- [x] Verify with the smallest relevant checks first, then broader suites as needed. Do not claim "all tests pass" unless all eight repo suites in `AGENTS.md` are clean.
- [x] Update this todo file by checking off each deliverable that is actually implemented.

## Open Items

No unresolved open items.

## References

- Mockup: `docs/notes/mcp-account-tools-ui-fee-edit/mcp-account-tools-ui-fee-edit-mockup.png`
- Scope debate note: none
- Linear tickets: none
