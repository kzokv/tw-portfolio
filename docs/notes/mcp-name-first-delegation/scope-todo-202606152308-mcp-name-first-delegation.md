---
slug: mcp-name-first-delegation
source: scope-grill
created: 2026-06-15
tickets: []
required_reading: []
superseded_by: null
---

# Todo: MCP Name-First Delegation

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [x] Reconfirm the current worktree is `/Users/lume/repos/tw-portfolio/.worktrees/codex/sharing-mcp-delegated-capabilities` on branch `codex/sharing-mcp-delegated-capabilities`, based on latest `dev`, and record starting HEAD/status.
- [x] Inspect the current MCP catalog and handlers before editing: `apps/api/src/mcp/tools.ts`, `apps/api/src/mcp/registerMcpRoutes.ts`, `apps/api/src/mcp/policy.ts`, `apps/api/src/mcp/types.ts`, `apps/api/src/services/mcpDrafts.ts`, `apps/api/src/services/mcpAccounts.ts`, `apps/api/src/services/mcpPortfolioRead.ts`, `libs/shared-types/src/index.ts`, and existing MCP tests.
- [x] Add shared MCP helper modules for portfolio label/email resolution, account-name resolution, draft batch-label resolution, rowNumber-to-rowId resolution, confirmation summary/digest generation, and wrapper-to-existing-service adaptation. Wrappers must reuse existing service/domain mutation logic rather than duplicate it.
- [x] Add `list_portfolio_contexts` scoped to `portfolio:mcp_read`, returning self and active delegated portfolios with model-visible label/email/capabilities and no internal IDs in `structuredContent`/`content`; place internal IDs only in `_meta` if widgets need them.
- [x] Add optional `portfolio: { label: string; email?: string }` to model-visible read tools while preserving `portfolioContextUserId` for backward compatibility. Reject when both selectors are present and disagree. Reads may still default to self when no selector is supplied.
- [x] Require explicit `portfolio` on all new model-facing write wrappers; reject missing portfolio instead of defaulting to self.
- [x] Add `accountNames?: string[]` filters to `get_recent_transactions` and `get_cash_balance_summary`, keep `accountIds?: string[]` backward-compatible, and reject/conflict when name and ID filters disagree or ambiguous names are used.
- [x] Add `list_draftable_account_names` scoped to `transaction_draft:create` or `transaction_draft:edit`, returning only active account names plus minimal drafting metadata such as account type, default currency, inferred/default market code, and duplicate-name warnings.
- [x] Add `list_account_names` scoped to `account:manage`, returning active and optionally deleted account names, status, type, currency, and lifecycle context without exposing balances by default.
- [x] Add account management preview/commit wrappers: `preview_create_account_by_name`, `create_account_by_name`, `preview_update_account_by_name`, `update_account_by_name`, `preview_soft_delete_account_by_name`, `soft_delete_account_by_name`, `preview_restore_account_by_name`, and `restore_account_by_name`.
- [x] Make account wrappers strict name-first. Duplicate active account names block with a clear ambiguity error. `restore_account_by_name` resolves only a unique deleted account name; duplicate deleted names block; active-name collision restore must report the final auto-renamed account name.
- [x] Add name-first draft candidate wrappers `preflight_transaction_draft_candidates_by_name` and `create_transaction_draft_batch_by_name`. Candidate rows must use `accountName`; account ID fallback is not allowed for model-facing wrappers.
- [x] Add name-first draft batch wrappers `list_transaction_draft_batches_by_name`, `get_transaction_draft_batch_by_name`, and `show_transaction_draft_batch_by_name`, using human `batchLabel` selectors.
- [x] Implement `batchLabel` without a DB migration unless a hard blocker appears. Prefer existing metadata such as source label/provenance plus deterministic generated labels and short suffixes only when needed for uniqueness. Ambiguous batch labels must block and instruct the model to list batches.
- [x] Add row lifecycle wrappers `update_transaction_draft_rows_by_name`, `exclude_transaction_draft_rows_by_name`, `reinclude_transaction_draft_rows_by_name`, `reject_transaction_draft_rows_by_name`, `archive_transaction_draft_batch_by_name`, and `delete_unconfirmed_transaction_draft_batch_by_name`.
- [x] Use `rowNumber` as the model-facing row selector for all row wrappers. Resolve row numbers server-side to row IDs, block missing/duplicate/confirmed/non-mutable rows with readable errors, and keep row IDs out of model-visible wrapper outputs.
- [x] Add posting wrappers `get_transaction_draft_posting_preview_by_name` and `post_transaction_draft_rows_by_name`, using portfolio label/email, batch label, row numbers, and account names.
- [x] Keep direct posted transaction create/edit/delete MCP tools out of scope. Transaction management remains draft creation, review, and confirm/post.
- [x] Preserve exact capability semantics: `portfolio:mcp_read` for context/read tools; `account:manage` for account lifecycle; `transaction_draft:create` for draft template/preflight/create; `transaction_draft:edit` for draft list/get/update/exclude/reinclude/reject/preview; `transaction_draft:archive` for archive; `transaction_draft:delete` for delete unconfirmed; `transaction:write` only for posting draft rows.
- [x] Add deterministic `confirmationSummary` and `confirmationDigest` to every model-facing write preview/get result. Commit wrappers must require both, recompute from canonical current state, and reject stale/mismatched digests with a clear error.
- [x] Use thresholded confirmation summaries: include full per-row detail up to 20 rows; use compact bulk summaries above 20 rows with row count, accounts, tickers, totals, and explicit review language.
- [x] Ensure new model-facing wrapper `structuredContent`/`content` avoids internal IDs. Internal IDs may be supplied through `_meta` only for widgets/internal use.
- [x] Do not attempt full ID scrubbing of existing read/report DTOs in this scope; document that the ID-free guarantee applies to new wrappers and delegated write workflow outputs.
- [x] Mark old ID-heavy lifecycle tools as app/widget-visible only via `_meta.ui.visibility: ["app"]` while preserving existing handlers for backward compatibility and existing widgets. Keep read/report/search tools model-visible.
- [x] Update low-level tool descriptions to identify them as widget/internal where applicable, and update new wrapper descriptions so ChatGPT resolves portfolio/account/batch context by names and uses wrappers for model-facing delegated workflows.
- [x] Update ChatGPT transaction draft/account widgets only as needed so widget-initiated calls continue to use app-visible low-level tools and displayed portfolio/account names remain readable.
- [x] Update relevant docs and scope notes to describe name-first delegated MCP workflows, capability boundaries, metadata refresh requirements, and the transition/backward-compatibility model.
- [x] Add MCP catalog/metadata tests proving new tools are present with correct scopes, old ID-heavy lifecycle tools use `_meta.ui.visibility: ["app"]`, read/report/search tools remain model-visible, and annotations remain correct.
- [x] Add MCP policy/context tests for `list_portfolio_contexts`, self/delegated labels/emails/capabilities, revoked/invalid share behavior, and missing-portfolio rejection for model-facing writes.
- [x] Add name-resolution tests for portfolio label/email matching, ambiguous portfolio labels, unique and duplicate active account names, unique and duplicate deleted account names, account-ID rejection in `_by_name` wrappers, batch-label resolution/ambiguity, and rowNumber resolution.
- [x] Add delegated MCP draft workflow tests covering preflight/create by account name in owner context, list/get/show by batch label, row update/exclude/reinclude/reject by row number, archive/delete by batch label, posting preview/post by row number, `transaction:write` required only for posting, and draft create allowed without `transaction:write`.
- [x] Add account-management wrapper tests covering preview/commit digest validation, delegated create/update/soft-delete/restore, ambiguity blockers, final restore name reporting, and capability denial.
- [x] Add read-tool compatibility tests for optional `portfolio` selectors, old `portfolioContextUserId`, `accountNames`, old `accountIds`, and conflict behavior when old/new selectors disagree.
- [x] Add ChatGPT widget/unit tests proving widgets can still call app-visible low-level tools and no account-manager or transaction-draft component flow regresses.
- [x] Run `/aaa` to add or update E2E tests covering the flows agreed in this scope session.
- [x] Run focused MCP/API/web tests first during implementation, then all eight `AGENTS.md` full repo gates before PR readiness. Do not claim "full tests pass" unless all eight suites are clean.
- [ ] Include connector metadata refresh/re-scan in release validation. Do not claim done until ChatGPT dev connector sees the new tool metadata and no longer model-selects old ID-heavy lifecycle tools.
- [ ] Live validate in ChatGPT: discover `KC vtwin` via `list_portfolio_contexts`, create a draft in KC vtwin's portfolio by account name, show readable confirmation/posting UX with portfolio/account/row summaries, and avoid raw IDs in the user-facing consent path.

## Current Validation Evidence

Full local `AGENTS.md` gates are clean. This update does not claim live ChatGPT validation, PR/deploy, metadata refresh, or deployed-branch validation.

- Preflight: `git fetch origin dev`; `origin/dev` = `9edb12c6d18463ca5c6f808c11b7fbafcf6ef48c`; `git merge-base --is-ancestor origin/dev HEAD` = 0; branch = `codex/sharing-mcp-delegated-capabilities`; HEAD = `8732b472c6359a3c853b79ec3f25de8280e446f2`; git status had the MCP/API/web/doc changes listed in this scope.
- `npx vitest run test/integration/mcp-name-first-delegation.integration.test.ts` — 10 passed
- `npx vitest run test/integration/mcp.integration.test.ts test/integration/mcp-name-first-delegation.integration.test.ts` — 26 passed
- `npm run test --prefix apps/api` — 153 files passed, 42 skipped; 1592 tests passed, 422 skipped after the HTTP AAA spec update
- `npm run test --prefix apps/web` — 56 files passed; 392 tests passed after the HTTP AAA spec update
- Widget tests — 11 passed
- `npm run typecheck` — passed after the HTTP AAA spec update
- `npx eslint .` — passed after the HTTP AAA spec update
- `npx playwright test test/http/specs/mcp-name-first-delegation-aaa.http.spec.ts --config test/http/playwright.config.ts` — 1 passed; covers delegated MCP account create and draft preflight/create/post by human portfolio/account/batch/row selectors over the real HTTP `/mcp` transport after enabling MCP read/drafts/write policy through admin fresh-auth.
- `npm run test:integration:full:host` — 85 files passed; 852 tests passed, 1 skipped; managed CI stack stopped cleanly.
- `npm run test:e2e:bypass:mem --prefix apps/web` — 275 passed, 12 skipped; includes delegated sharing permission editing, shared transaction gating, shared account management gating, ChatGPT widget harness, and portfolio switcher coverage.
- `npm run test:e2e:oauth:mem --prefix apps/web` — 120 passed.
- `npm run test:http --prefix apps/api` — 290 passed, 2 skipped

## Current Diff Notes

- The current diff shows route wiring and tool metadata updates for the model-facing `_by_name` wrappers plus `list_portfolio_contexts`.
- The current diff preserves widget/internal low-level handlers while making their visibility/tool descriptions app-oriented.
- The current diff adds `accountNames` support for read tools and widget-side compatibility updates so app-visible low-level tools still render readable account labels.
- The current focused MCP tests now cover delegated account create/update/soft-delete/restore, restore collision final names, draft row update/exclude/reinclude/reject, draft batch archive/delete, and draft create/post by human selectors.
- The current HTTP AAA coverage exercises the model-facing MCP transport and validates the visible payload from `structuredContent` or text JSON fallback remains free of internal portfolio/account/batch/row IDs for the delegated name-first account and draft posting path.
- The current diff aligns MCP delegated missing-capability errors to `shared_capability_required` and returns non-5xx route errors as structured MCP tool errors with `code`, `message`, and `statusCode`.
- The current diff keeps the ID-free guarantee scoped to new model-facing wrappers and delegated workflow outputs. Existing read/report DTOs and old low-level handlers remain backward-compatible during the metadata transition.
- Connector metadata refresh/re-scan remains a release validation item: the dev ChatGPT connector must observe the new `_by_name` tools and app-only visibility for old lifecycle tools before this scope is complete.
- Items left unchecked above remain unverified or unsupported by the current diff/evidence and should not be treated as complete.

## Open Items

- None.

## Out Of Scope

- Direct posted transaction create/edit/delete MCP tools.
- Hard purge delegation.
- Recompute, snapshots, dividends, FX transfer, corporate action, monitored ticker, backfill/repair, profile/admin/connector/notification writes.
- Full ID scrubbing for all existing read/report DTOs.
- New app page redesigns, account alias management UI, bulk import redesign, or broader sharing UI redesign.
- Server-side rejection of old ID-heavy handlers during the metadata transition window.

## References

- Current worktree: `/Users/lume/repos/tw-portfolio/.worktrees/codex/sharing-mcp-delegated-capabilities`
- Current branch: `codex/sharing-mcp-delegated-capabilities`
- Prior delegated-capabilities scope: `docs/notes/sharing-mcp-delegated-capabilities/scope-todo-202606151503-sharing-mcp-delegated-capabilities.md`
- MCP catalog: `apps/api/src/mcp/tools.ts`
- MCP route dispatcher: `apps/api/src/mcp/registerMcpRoutes.ts`
- MCP policy: `apps/api/src/mcp/policy.ts`
- MCP draft service: `apps/api/src/services/mcpDrafts.ts`
- MCP account service: `apps/api/src/services/mcpAccounts.ts`
- Shared MCP/DTO types: `libs/shared-types/src/index.ts`
- Existing MCP integration tests: `apps/api/test/integration/mcp.integration.test.ts`
