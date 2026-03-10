# Latest Handoff

## Completed
- Implemented `KZO-52` for sell realized P&L derivation.
- Added shared accounting helpers so sell `realizedPnlNtd` is derived from canonical `trade_events` plus `lot_allocations`.
- Updated sell posting and recompute flows so realized P&L no longer depends on previously stored in-memory `realizedPnlNtd`.
- Updated Postgres load/save paths so canonical reloads and legacy `transactions.realized_pnl_ntd` mirror writes both derive from canonical allocations rather than trusting trade-object state.
- Added regression coverage for stale-state cases in memory and Postgres integration tests.
- Verified with `npm run test -w apps/api -- portfolio.integration.test.ts`, `npm run build -w @tw-portfolio/api`, and `npm run test:integration:ci:host`.

## Decisions
- Treat sell `realizedPnlNtd` as a derived value from canonical trade facts plus disposal projections, not as authoritative mutable trade state.
- Keep the legacy `transactions` mirror as a compatibility write target for now, but derive its `realized_pnl_ntd` from canonical allocations instead of copying `tx.realizedPnlNtd`.
- Do not add a fallback to legacy mirrored realized P&L reads when canonical `lot_allocations` are absent.

## Next steps
- Refresh `.worklog/current-focus.md` to the next ranked queue item after `KZO-52`.
- Decide whether the legacy `transactions` mirror should keep being rewritten during Wave 2 or be frozen/retired once downstream compatibility needs are confirmed.
- Decide whether recompute endpoints remain temporary compatibility shims or should be frozen as canonical write-path contracts solidify.

## Risks or blockers
- The legacy `transactions` table is still written, so the dual-write seam remains even though canonical derivation now wins.
- Historical rows without canonical `lot_allocations` still need an explicit product/data-policy decision if they must be supported.

## Open questions
- Should any remaining legacy mirror fields continue to be populated once downstream readers are confirmed off the compatibility table?
- When should recompute-era endpoints be frozen or retired relative to the remaining Wave 2 work?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `apps/api/src/services/accountingStore.ts`
- `apps/api/src/services/portfolio.ts`
- `apps/api/src/services/recompute.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/test/integration/portfolio.integration.test.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
