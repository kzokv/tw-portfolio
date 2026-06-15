---
slug: sharing-mcp-delegated-capabilities
source: scope-grill
created: 2026-06-15
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Sharing MCP Delegated Capabilities

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Deliver bounded V1 delegation for shared portfolio management from both the web app and ChatGPT MCP connector.
2. Reuse existing share capability strings where possible: `account:manage`, `transaction:write`, `transaction_draft:create`, `transaction_draft:edit`, `transaction_draft:archive`, `transaction_draft:delete`, and `portfolio:mcp_read`.
3. Allow viewer-role grantees to write only in an active shared context and only when the owner granted the matching share capability.
4. Keep own-context viewer writes blocked with `write_blocked_viewer_role`.
5. Keep impersonation writes blocked with `impersonation_write_blocked`.
6. Return `403 shared_capability_required` for shared-context app writes that are missing the required capability.
7. Keep revoked or invalid shared contexts on the existing fallback path.
8. Allow owners to edit permissions after share creation for both active shares and pending share-coupled invites.
9. Preserve pending invite URLs/codes when editing pending invite permissions.
10. Keep anonymous public links read-only and out of scope.
11. Keep connector OAuth consent separate: owner share approval does not auto-upgrade a delegate's ChatGPT OAuth connector scopes.
12. Include old and new capability arrays in share-permission update audit metadata.
13. Make backend permission changes immediate; rely on existing sharing notification/SSE/refetch behavior for frontend eventual refresh.
14. Keep `account:manage` scoped to account create/edit/soft-delete/restore, fee profiles, fee profile bindings, and account fee config required for transaction correctness.
15. Exclude hard purge, recompute, snapshot regeneration, dividends, FX transfers, monitored tickers, backfill, and repair from V1 delegation.
16. Keep `transaction:write` scoped to posted transaction create/edit/delete, direct AI transaction confirm, and AI draft posting.
17. Keep draft mutation capabilities separate: draft editing uses `transaction_draft:edit`; archive/delete use their matching `transaction_draft:*` capabilities.
18. Use `GET /shares` inbound share data as the frontend source for shared-context effective permissions; do not add a new permissions endpoint in V1.
19. Add outbound-row Edit permissions UI for active shares and pending invites.
20. Make the web shared-context transaction/account UI capability-aware instead of blanket read-only.
21. Respect the latest route DTO cache rules: cache keys stay partitioned by session user and selected owner, and delegated app writes must clear affected route DTO cache entries.

## Implementation Steps

- [x] Reconfirm baseline from latest `dev` in the worktree and inspect these files before editing: `apps/api/src/routes/registerRoutes.ts`, `apps/api/src/lib/routeGuards.ts`, `apps/api/src/mcp/policy.ts`, `apps/api/src/services/mcpAccounts.ts`, `apps/api/src/services/mcpDrafts.ts`, `apps/web/features/sharing/service.ts`, `apps/web/features/sharing/types.ts`, `apps/web/components/layout/AppShell.tsx`, `apps/web/components/layout/AppShellDataContext.tsx`, `apps/web/components/layout/useAppShellDataValue.ts`, `apps/web/components/layout/useSharedContext.ts`, `apps/web/lib/routeDtoCache.ts`, and `.claude/rules/route-dto-cache-user-context.md`.
- [x] Add an app-write capability matrix for shared-context route keys. Map `account:manage` to `PUT /settings/fee-config`, `POST /accounts`, `PATCH /accounts/:id`, `DELETE /accounts/:id`, `POST /accounts/:id/restore`, `POST /fee-profiles`, `PATCH /fee-profiles/:id`, `DELETE /fee-profiles/:id`, and `PUT /fee-profile-bindings`.
- [x] Map `transaction:write` to `POST /portfolio/transactions`, `PATCH /portfolio/transactions/:tradeEventId`, `DELETE /portfolio/transactions/:tradeEventId`, `POST /ai/transactions/confirm`, and `POST /ai/transaction-drafts/:batchId/confirm`.
- [x] Map draft routes to their existing draft capabilities: `PATCH /ai/transaction-drafts/:batchId/rows/:rowId`, `POST /ai/transaction-drafts/:batchId/exclude`, `POST /ai/transaction-drafts/:batchId/reinclude`, and `POST /ai/transaction-drafts/:batchId/reject` require `transaction_draft:edit`; `POST /ai/transaction-drafts/:batchId/archive` requires `transaction_draft:archive`; `DELETE /ai/transaction-drafts/:batchId` requires `transaction_draft:delete`.
- [x] Explicitly leave these routes owner-only in shared context: `POST /accounts/:id/purge`, FX transfer mutations, dividend mutations, corporate actions, snapshot generation, recompute preview/confirm, monitored ticker updates, backfill retry/repair, share-token creation/deletion, connector settings mutations, profile mutations, notifications, and admin routes.
- [x] Refactor route authorization so shared-context viewer writes can pass only when the route matrix requires a capability and the active share includes it. Preserve current behavior for own-context viewer writes and impersonation writes.
- [x] Add a small backend helper that resolves the active share and its capabilities from `req.authContext.sessionUserId` and `req.authContext.contextUserId`; avoid duplicating MCP policy logic across route handlers.
- [x] Make the missing-capability app error `403 shared_capability_required` with metadata that includes the required capability and route key where practical.
- [x] Keep support read routes callable in shared context, including `POST /portfolio/transactions/estimate` and `GET /portfolio/transactions/:tradeEventId/preview-impact`, so enabled transaction UI can calculate fees and show edit/delete impact.
- [x] Update app account lifecycle audit attribution so delegated app writes use the delegate/session user as `actorUserId` and preserve the portfolio owner/context in metadata or target fields. Match the MCP account mutation pattern where feasible.
- [x] Keep `POST /accounts/:id/purge` denied even when the share has `account:manage`; add regression coverage for this.
- [x] Update share capability update routes to read previous capabilities before writing and append audit metadata with both `oldCapabilities` and `newCapabilities` for active shares and pending invites.
- [x] Add web API clients for `PATCH /shares/:id/capabilities` and `PATCH /shares/pending/:code/capabilities`.
- [x] Add `account:manage` to the share capability picker source. Update labels/copy from AI-only wording to portfolio delegation wording while still explaining ChatGPT connector implications.
- [x] Preserve inbound share capabilities in `InboundShareCardItem` by carrying `dto.capabilities` through `toInboundCard`.
- [x] Derive effective shared-context permission booleans in AppShell from the current inbound share capabilities and expose them through `AppShellData`.
- [x] Update `canUseGlobalQuickActions` so shared contexts with `transaction:write` can open Add transaction, while recompute and snapshot actions remain hidden/disabled in shared context.
- [x] Update transaction pages/components so shared-context users with `transaction:write` can create, edit, and delete posted transactions; users without it see read-only behavior.
- [x] Update AI draft web surfaces so viewer grantees are not blocked by role guard when the corresponding share capability is present; keep draft edit/archive/delete/posting capability-specific.
- [x] Update account settings UI so shared-context users with `account:manage` can create/edit/soft-delete/restore accounts and manage fee profiles/bindings, while hard purge remains unavailable.
- [x] Add outbound-row Edit permissions dialog for active shares and pending invites. It should initialize from the row capabilities, save through the correct PATCH route, preserve invite URL/code, refresh sharing data, and show errors inline.
- [x] Clear affected route DTO cache entries after delegated transaction/account/fee writes. Transaction hooks already clear route tags; account and fee config flows need equivalent invalidation or a shared refresh wrapper.
- [x] Keep route DTO cache keys using `getRouteDtoContextScope(sessionUserId)` and add or update tests that prove session-user plus selected-owner partitioning still holds for delegated shared contexts.
- [x] Update stale docs that still describe `transaction:write` as future-only, especially `docs/002-operations/runbook.md`, while preserving the advanced opt-in consent guidance.
- [x] Add API tests for viewer grantee with `transaction:write` creating/editing/deleting owner transactions, viewer grantee without capability receiving `shared_capability_required`, and viewer grantee with `account:manage` creating/editing/soft-deleting/restoring owner accounts.
- [x] Add API tests proving `account:manage` does not allow hard purge and does not allow out-of-scope routes such as recompute, snapshots, dividends, FX transfers, monitored tickers, backfill, and share-token creation/deletion.
- [x] Add API tests for active and pending share permission edits, including audit metadata with old and new capability arrays.
- [x] Add MCP tests for shared `account:manage` coverage if current tests do not already cover create/update/soft-delete/restore against a shared owner context. Keep existing shared `transaction:write` posting coverage.
- [x] Add web unit/component tests for AppShell derived permissions, `GrantShareDialog` capability list including `account:manage`, inbound capability preservation, outbound edit-permissions dialog, and cache invalidation after account/fee writes.
- [x] Run `/aaa` to add or update E2E tests covering the flows agreed in this scope session.
- [x] Add web E2E coverage for outbound edit permissions on active and pending shares, shared transaction UI enabled/disabled by `transaction:write`, and shared account-management UI enabled/disabled by `account:manage`.
- [x] Run the smallest relevant tests first, then expand. Do not claim "full tests pass" unless all eight repo suites from `AGENTS.md` are clean.

## Verification Evidence

- Baseline: worktree branch `codex/sharing-mcp-delegated-capabilities`, starting HEAD `9edb12c6d18463ca5c6f808c11b7fbafcf6ef48c` matching `origin/dev`.
- API integration: `npm run test -w apps/api -- shared-context-delegated-capabilities.integration.test.ts` passed, 5 tests.
- MCP focused integration: `npm run test -w apps/api -- mcp.integration.test.ts -t "requires shared account:manage|requires transaction:write"` passed, 2 tests.
- API HTTP: `npm run test:http -w apps/api -- test/http/specs/switcher-write-blocked-aaa.http.spec.ts test/http/specs/switcher-narrow-taxonomy-aaa.http.spec.ts test/http/specs/switcher-delegated-transaction-write-aaa.http.spec.ts` passed, 3 tests.
- Web unit/component: `cd apps/web && npx vitest run test/components/sharing test/components/layout/PortfolioSwitcher.test.tsx test/components/transactions/TransactionsClient.test.tsx test/lib/api.test.ts test/lib/routeDtoCache.test.ts` passed, 10 files / 45 tests.
- API and web typecheck: `npx tsc --noEmit --incremental false -p apps/api/tsconfig.json --pretty false` and `npx tsc --noEmit --incremental false -p apps/web/tsconfig.json --pretty false` passed after review fixes.
- Whitespace guard: `git diff --check` passed after review fixes.
- Web E2E: `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/sharing-delegated-capabilities-aaa.spec.ts` passed, 3 tests.
- API HTTP focused fix: `npx playwright test --config apps/api/test/http/playwright.config.ts apps/api/test/http/specs/anon-token-create-switched-in-403-aaa.http.spec.ts apps/api/test/http/specs/anon-token-create-viewer-403-aaa.http.spec.ts` passed, 2 tests, after aligning stale anonymous-token assertions with the locked error taxonomy.
- Full repo gate 1: `npx eslint .` passed.
- Full repo gate 2: `npm run typecheck` passed.
- Full repo gate 3: `npm run test --prefix apps/web` passed: 46 files / 252 tests, then 56 files / 392 tests.
- Full repo gate 4: `npm run test --prefix apps/api` passed: 152 files / 1582 tests, 42 files skipped.
- Full repo gate 5: `npm run test:integration:full:host` passed: 84 files / 842 tests, 1 skipped.
- Full repo gate 6: `npm run test:e2e:bypass:mem --prefix apps/web` passed: 275 tests, 12 skipped.
- Full repo gate 7: `npm run test:e2e:oauth:mem --prefix apps/web` passed: 120 tests.
- Full repo gate 8: `npm run test:http --prefix apps/api` passed: 289 tests, 2 skipped.

## Open Items

- None.

## Out Of Scope

- Anonymous public links with write permissions.
- Automatic ChatGPT OAuth scope upgrades from owner share approval.
- Hard purge delegation.
- Recompute, snapshot generation, snapshot repair, and backfill delegation.
- Dividend, FX transfer, corporate action, monitored ticker, profile, notification, connector settings, and admin-surface delegation.
- A new live ACL channel beyond existing sharing notification/SSE/refetch behavior.

## References

- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/codex/sharing-mcp-delegated-capabilities`
- Branch: `codex/sharing-mcp-delegated-capabilities`
- Latest reviewed `dev`: `9edb12c6d18463ca5c6f808c11b7fbafcf6ef48c`
- Backend route guard: `apps/api/src/routes/registerRoutes.ts`, `apps/api/src/lib/routeGuards.ts`
- MCP policy: `apps/api/src/mcp/policy.ts`, `apps/api/src/services/mcpAccounts.ts`, `apps/api/src/services/mcpDrafts.ts`
- Sharing frontend: `apps/web/features/sharing/service.ts`, `apps/web/features/sharing/types.ts`, `apps/web/components/sharing/GrantShareDialog.tsx`, `apps/web/components/sharing/OutboundSharesTable.tsx`
- AppShell context: `apps/web/components/layout/AppShell.tsx`, `apps/web/components/layout/AppShellDataContext.tsx`, `apps/web/components/layout/useAppShellDataValue.ts`, `apps/web/components/layout/useSharedContext.ts`
- Route cache rule: `.claude/rules/route-dto-cache-user-context.md`, `apps/web/lib/routeDtoCache.ts`
- Mockup source: `docs/notes/sharing-mcp-delegated-capabilities/mockups/sharing-delegated-capabilities.html`
- Mockup screenshots: `docs/notes/sharing-mcp-delegated-capabilities/mockups/screenshots/edit-permissions-desktop.png`, `docs/notes/sharing-mcp-delegated-capabilities/mockups/screenshots/shared-transaction-controls-desktop.png`, `docs/notes/sharing-mcp-delegated-capabilities/mockups/screenshots/shared-account-management-mobile.png`
- Scope debate note: none
- Linear tickets: none
