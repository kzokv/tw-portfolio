# Latest Handoff

## Completed
- Verified the live Linear execution queue and corrected the stale local pickup assumption: on `dev`, `KZO-46` was already implemented, so the next ranked incomplete ticket was `KZO-50`.
- Implemented `KZO-50` for the canonical trade posting path by allowing `POST /portfolio/transactions` to accept optional booked `commissionNtd` and `taxNtd` overrides.
- Kept fee-profile-derived charges as suggestions only; posted trade facts now persist explicit booked overrides without changing the stored `feeSnapshot`.
- Updated buy-side lot projection so nonzero booked buy tax contributes to acquisition cost, keeping holdings cost aligned with booked trade charges rather than only the cash settlement entry.
- Added in-memory API integration coverage for booked buy/sell overrides and validation failure on negative override inputs.
- Expanded Postgres persistence coverage so canonical `trade_events`, `cash_ledger_entries`, `lots`, reloadable holdings, and derived sell realized P&L reflect booked override values.

## Decisions
- Treat the Linear `Execution Queue and Session Pickup Order` document as the live source of truth for ranked pickup order over any stale repository handoff text.
- Treat booked commission and tax as canonical trade facts that may override fee-profile suggestions on a per-posted-trade basis.
- Keep `feeSnapshot` as reference context for how defaults were suggested, not as authority over booked trade charges after posting.
- Flow nonzero booked buy tax into lot acquisition cost so holdings and future disposal cost basis remain consistent with booked trade economics.
- Keep broader recompute/freeze behavior out of `KZO-50`; that contract boundary remains follow-on work.

## Next steps
- Pick up `KZO-52` next: derive sell `realizedPnlNtd` solely from canonical trade facts and disposal projections and narrow the remaining legacy mirror seam.
- Re-run the managed Postgres integration suite once Docker access is available; the route-level in-memory suite and package builds passed, but the managed host wrapper could not run in this session.
- Decide whether recompute endpoints should remain temporary compatibility shims or be frozen as Wave 2 canonical write-path contracts solidify.

## Risks or blockers
- Docker was unavailable in this environment, so `npm run test:integration:ci:host` could not reach the daemon and the managed Postgres suite was not executed here.
- Legacy recompute endpoints still exist and may rewrite booked charges in ways that conflict with the intended immutable-accounting direction.
- The legacy `transactions` mirror is still written during canonical trade persistence, so dual-authority seams remain until `KZO-52` and later cleanup work land.

## Open questions
- For `KZO-52`, should historical Postgres rows without `lot_allocations` keep any temporary fallback, or can pre-cutover data be treated as disposable scaffolding?
- When should recompute-era endpoints be frozen or retired relative to `KZO-50`, `KZO-52`, and `KZO-49`?
- What canonical read-model guarantees need to be documented once sell realized P&L no longer depends on mirrored legacy fields?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/services/portfolio.ts`
- `apps/api/test/helpers/fixtures.ts`
- `apps/api/test/integration/portfolio.integration.test.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
- `apps/web/components/portfolio/types.ts`
