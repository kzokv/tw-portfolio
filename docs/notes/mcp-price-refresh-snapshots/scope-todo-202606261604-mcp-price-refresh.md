---
slug: mcp-price-refresh-snapshots
source: scope-grill
created: 2026-06-26
tickets: []
required_reading: []
superseded_by: null
---

# Todo: MCP Price Refresh, Recompute, Replay, Backfill, And Snapshots

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope Decisions

- Add a small MCP tool family rather than one mega-tool.
- Keep all mutation behavior scoped to the selected user or delegated portfolio context.
- Exclude admin/provider-wide backfill and arbitrary ticker refresh/backfill from v1.
- Use bounded synchronous work plus queued async work where operations can exceed MCP request limits.
- Add `refresh_portfolio_prices`, `preview_recompute_portfolio_fees`, `recompute_portfolio_fees`, `preview_replay_portfolio_positions`, `replay_portfolio_positions`, `get_replay_portfolio_positions_run`, `backfill_tickers`, and `get_daily_snapshots`.
- Treat `get_daily_snapshots` as holding snapshots only in v1.
- Require `transaction:write` for mutation tools and `portfolio:mcp_read` for read/status tools.
- Require server-owned preview confirmation for fee recompute and position replay.
- Expire replay confirmations after 15 minutes and revalidate selected portfolio ownership/scope at confirm time.
- Run position replay asynchronously with per-scope outcomes queryable through `get_replay_portfolio_positions_run`.
- Use existing MCP access logs, market-data activity, and events; do not add a broad audit table in v1.
- Do not add new web UI in v1 beyond the recompute confirmation copy correction.

## Implementation Steps

- [x] Correct the existing web recompute confirmation copy so it describes fee/tax/realized-gain/settlement cash recompute plus snapshot refresh instead of full lot/allocation replay.
- [x] Add MCP tool definitions and schemas in `apps/api/src/mcp/tools.ts`.
- [x] Add MCP dispatch cases in `apps/api/src/mcp/registerMcpRoutes.ts`.
- [x] Extract service orchestration for `refresh_portfolio_prices` that resolves held ticker-market pairs, applies optional narrowing filters, runs close refresh up to the existing sync cap, queues excess close refresh work, and enqueues eligible intraday refreshes.
- [x] Add `preview_recompute_portfolio_fees` as an MCP wrapper around existing recompute preview semantics, returning the recompute job id, affected item count, and bounded fee/tax deltas.
- [x] Add `recompute_portfolio_fees` as confirmed execution for a server-owned preview job, reusing existing recompute confirm behavior and returning recompute job details plus holding/wallet snapshot refresh identifiers.
- [x] Add replay preview persistence or another server-owned confirmation mechanism for `preview_replay_portfolio_positions`, including selected account/ticker/market scopes, warnings, confirmation digest, and 15-minute expiry.
- [x] Add `replay_portfolio_positions` confirmed execution that validates the preview, revalidates scopes, creates a replay run id, and queues per-scope replay work.
- [x] Add replay run/status persistence sufficient for `get_replay_portfolio_positions_run` to return per-scope pending, running, succeeded, and failed outcomes.
- [x] Add the queued replay worker/path that reuses `replayPositionHistory(...)` per `(accountId, ticker, marketCode)` scope and recomputes snapshots for the affected scope when appropriate.
- [x] Add `backfill_tickers` as a portfolio-scoped repair enqueue tool for held/monitored ticker-market pairs only, with no provider selection and no force bypass.
- [x] Add `get_daily_snapshots` for holding snapshots only, with date filters, account/ticker/market filters, pagination, provisional row control, summary counts, and no advice/performance interpretation.
- [x] Add or extend persistence methods for scoped held/monitored pair resolution, holding snapshot reads, replay previews, and replay run status only where existing APIs are insufficient.
- [x] Add validation for cross-listed tickers so MCP inputs resolve market identity explicitly and do not silently prefer a legacy market.
- [x] Add tests for MCP tool success paths, validation failures, auth/capability denial, stale confirmation, cross-portfolio isolation, queue-unavailable behavior, and replay run status reads.
- [x] Run `/aaa` or equivalent API/E2E contract coverage for new MCP/API tool flows.

## Open Items

- [x] Decide during implementation whether replay run/status persistence should be a new narrow table or fit cleanly into an existing job/status structure.
- [x] Decide the exact max scope count for replay previews and the exact max row count/page size for `get_daily_snapshots`, using existing app config patterns where practical.

## References

- Scope debate note: none
- Linear tickets: none
- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/mcp-price-refresh-snapshots`
- UI copy fix: `apps/web/components/layout/i18n.ts`

## QA Evidence Notes

- 2026-06-26 implementation pass: added the MCP tool family in `apps/api/src/mcp/tools.ts`, dispatch in `apps/api/src/mcp/registerMcpRoutes.ts`, orchestration in `apps/api/src/services/mcpPortfolioMaintenance.ts`, replay queue worker in `apps/api/src/services/mcpReplayPositionRunWorker.ts`, memory/Postgres persistence methods, and migration `db/migrations/093_mcp_replay_position_runs.sql`.
- 2026-06-26 focused evidence: `npx vitest run test/unit/mcpPortfolioMaintenanceTools.test.ts test/unit/mcpPortfolioMaintenanceService.test.ts test/integration/mcp-portfolio-maintenance.integration.test.ts` passed 17 tests covering tool registration/scopes, explicit market identity, unsupported recompute ticker filters, recompute confirmation digest enforcement, ambiguous held-market rejection, replay preview scope rejection, stale replay confirmation, replay queue-unavailable rejection, failed replay enqueue status persistence, replay run status isolation, held/monitored backfill enforcement, historical snapshot reads without current holding requirement, MCP discovery, mutation auth denial, portfolio selector enforcement, and daily snapshot read success/pagination/provisional summary filtering.
- 2026-06-26 MCP regression evidence: `npx vitest run test/unit/mcpPortfolioMaintenanceTools.test.ts test/unit/mcpPortfolioMaintenanceService.test.ts test/integration/mcp-portfolio-maintenance.integration.test.ts test/integration/mcp.integration.test.ts test/integration/mcp-name-first-delegation.integration.test.ts` passed 44 tests after adding the maintenance tools and review fixes.
- 2026-06-26 focused lint evidence: `npx eslint apps/api/src/mcp/tools.ts apps/api/src/mcp/registerMcpRoutes.ts apps/api/src/services/mcpPortfolioMaintenance.ts apps/api/src/services/mcpReplayPositionRunWorker.ts apps/api/test/unit/mcpPortfolioMaintenanceTools.test.ts apps/api/test/unit/mcpPortfolioMaintenanceService.test.ts apps/api/test/integration/mcp-portfolio-maintenance.integration.test.ts apps/api/test/http/specs/mcp-portfolio-maintenance-aaa.http.spec.ts apps/api/src/persistence/types.ts apps/api/src/persistence/memory.ts apps/api/src/persistence/postgres.ts apps/api/src/plugins/pgBoss.ts` passed.
- 2026-06-26 route contract evidence added: `apps/api/test/http/specs/mcp-portfolio-maintenance-aaa.http.spec.ts` covers MCP daily snapshot read shape and write-tool portfolio-selector enforcement; `npx eslint apps/api/test/http/specs/mcp-portfolio-maintenance-aaa.http.spec.ts` passed.
- 2026-06-26 worktree dependency note: the first HTTP/API build attempts resolved `@vakwen/*` packages from the parent checkout because the worktree lacked workspace links. Running `npm install` in the worktree created local workspace symlinks, then `npm run build -w @vakwen/config -w libs/domain -w libs/shared-types -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/test-api` rebuilt the local package artifacts.
- 2026-06-26 API build evidence: `npm run build -w @vakwen/api` passed after local workspace links/artifacts were rebuilt.
- 2026-06-26 route contract runtime evidence: `npx playwright test --config test/http/playwright.config.ts test/http/specs/mcp-portfolio-maintenance-aaa.http.spec.ts` passed 1 HTTP MCP maintenance spec after switching the bearer token to an active OAuth-created user.
- 2026-06-26 full gate evidence: `npx eslint .` passed on the final diff.
- 2026-06-26 full gate evidence: `npm run typecheck` passed on the final diff after correcting the migration fixture catalog row shape.
- 2026-06-26 full gate evidence: `npm run test --prefix apps/web` passed before final backend-only provider-health/test-fixture corrections; no web files changed afterward.
- 2026-06-26 full gate evidence: `npm run test --prefix apps/api` passed before final provider-health/test-fixture corrections; the final corrections were covered by `npm run typecheck`, the focused provider-health HTTP spec, and the targeted migration integration spec.
- 2026-06-26 full gate evidence: `npm run test:integration:full:host` passed 93 files, 916 tests, 1 skipped after fixing the legacy migration fixture. The run included the new MCP maintenance integration coverage and verified the KZO-210 migration test after the duplicate tax-rule fixture and JP catalog persistence fixes.
- 2026-06-26 full gate evidence: `npm run test:e2e:bypass:mem --prefix apps/web` passed 300 tests, 16 skipped. Covered desktop/mobile responsiveness, tooltip accessibility, recompute confirmation flows, snapshot generation, and mutation auto-refresh without manual reload.
- 2026-06-26 full gate evidence: `npm run test:e2e:oauth:mem --prefix apps/web` passed 121 tests.
- 2026-06-26 full gate evidence: `npm run test:http --prefix apps/api` passed 298 tests, 2 skipped after updating the stale provider-health expected-provider list to the current 10-provider registry.
- 2026-06-26 focused post-fix evidence: `npm run build -w @vakwen/test-api && npx playwright test --config apps/api/test/http/playwright.config.ts apps/api/test/http/specs/provider-health-aaa.http.spec.ts` passed 15 provider-health HTTP tests.
- 2026-06-26 focused post-fix evidence: `VAKWEN_MANAGED_CI_STACK=1 RUN_POSTGRES_INTEGRATION=1 POSTGRES_PERSISTENCE_SKIP_REDIS_INIT=1 POSTGRES_TEST_DB_URL='postgres://app:app@192.168.64.1:15433/vakwen_ci?connect_timeout=10' POSTGRES_TEST_REDIS_URL='redis://192.168.64.1:16380' npx vitest run --no-file-parallelism test/integration/postgres-migrations.integration.test.ts` passed 34 migration tests against a temporary targeted Docker stack, which was then removed with `docker compose ... down -v --remove-orphans`.
- 2026-06-26 validation failures fixed: full Postgres integration initially exposed a duplicate `fee_profile_tax_rules_pkey` fixture setup and a JP catalog row that was pushed only into the memory store instead of persisted; both were fixed in `apps/api/test/integration/postgres-migrations.integration.test.ts`.
- 2026-06-26 validation failures fixed: full API HTTP initially failed `provider-health-aaa.http.spec.ts` because the test still expected 8 providers while the current registry returns 10. The spec now asserts the concrete provider IDs and the E2E seed schema includes JP provider IDs.
- 2026-06-26 validation notes: targeted migration reruns first failed because the host wrapper does not accept spec filters, then because the manual run lacked `VAKWEN_MANAGED_CI_STACK=1`, then because this VM cannot reach Docker published ports through `localhost`; the successful targeted run used `192.168.64.1`.
- Primary route-level regression coverage file: `apps/api/test/integration/mcp.integration.test.ts`
- Secondary delegation/isolation regression coverage file: `apps/api/test/integration/mcp-name-first-delegation.integration.test.ts`
- Tool-catalog/schema coverage files: `apps/api/test/unit/mcpPortfolioMaintenanceTools.test.ts` and `apps/api/test/http/specs/mcp-portfolio-maintenance-aaa.http.spec.ts`
- Implemented scenario coverage matrix:
- `refresh_portfolio_prices`: success, validation failure for bad scope filters, `transaction:write` denial, delegated cross-portfolio isolation, queue unavailable fallback/error, and rejection of arbitrary ticker/provider-wide requests outside held or monitored scope.
- `preview_recompute_portfolio_fees` and `recompute_portfolio_fees`: preview success, confirm success, stale confirmation rejection, confirmation digest mismatch rejection, delegated scope revalidation at confirm time, and queue/storage failure propagation if snapshot follow-up cannot be enqueued.
- `preview_replay_portfolio_positions`, `replay_portfolio_positions`, and `get_replay_portfolio_positions_run`: preview success, stale confirmation rejection after expiry, confirm success with async run creation, per-scope status reads, delegated isolation, and queue unavailable behavior.
- `backfill_tickers`: success for held or monitored ticker-market pairs only, validation failure for missing market identity on cross-listed input, denial of arbitrary ticker/provider-wide backfill, delegated isolation, and queue unavailable behavior.
- `get_daily_snapshots`: success, pagination and filter correctness, provisional-row toggle behavior, `portfolio:mcp_read` denial, delegated isolation, and summary counts tied to filtered result sets only.
