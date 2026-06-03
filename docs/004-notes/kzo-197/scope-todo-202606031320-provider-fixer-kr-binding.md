---
slug: kzo-197-provider-fixer-kr-binding
source: scope-grill
created: 2026-06-03
tickets: [KZO-197]
required_reading:
  - docs/004-notes/kzo-197/scope-todo-202605091500-locked.md
  - docs/004-notes/ui-reshape-shadcn/mockup-2026060209-admin-provider-fixer.html
  - docs/004-notes/ui-reshape-shadcn/screenshots/41-admin-provider-fixer-light.png
superseded_by: null
---

# Todo: Provider Fixer Guardrails + KR Binding

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The older KZO-197 todo shipped provider-health rerun/cooldown behavior; this addendum supersedes its inline KR rerun/fixer assumptions.

## Gap And Contradiction Check

- **Critical gap resolved by this scope:** the current code only has KR suffix probing and an in-memory `quoteFirstSymbolCache`; there is no durable binding such as `005930 -> yahoo-finance-kr:005930.KS`.
- **Critical contradiction resolved by this scope:** `/admin/providers` currently exposes inline `quote_first` / `chart_probe_v1` rerun controls, but the agreed UI moves all provider repair/rerun actions into a dedicated Provider Fixer.
- **Critical operations gap resolved by this scope:** current pg-boss batches are visible only indirectly; Provider Fixer must expose operation records, logs, active batch state, and guarded legacy cancellation.
- **Non-critical documentation drift:** runbook text that describes the inline KR resolver selector should be rewritten once the Provider Fixer route ships.

## Locked Decisions

1. `/admin/providers` becomes a read-only provider-health overview with `Open fixer` actions. UI-triggered provider reruns move to Provider Fixer.
2. Keep current admin roles; do not split permissions. Strong guardrails apply to dangerous actions.
3. Add Provider Fixer APIs under `/admin/provider-fixer/*` for summary, diagnostics, preview, stage, execute, pause, resume, cancel, operations, and logs.
4. Model provider work as first-class operations with phases: `diagnose -> preview -> staged -> running -> paused -> completed|failed|cancelled`.
5. Same provider+market active execution blocks another execution, but diagnose/preview remain allowed.
6. Include legacy active pg-boss batches in the fixer read model. Legacy batches support guarded cancel in v1; pause/resume only if proven safe.
7. Dangerous actions are query-backed and paginated. Preview stores scope query, match count, sample, snapshot hash, preview token, and token expiry.
8. Dangerous execution requires server preview token, explicit checkbox, typed confirmation, audit entry, and operation log.
9. Low-risk verified self-healing under configured thresholds uses normal confirmation, not typed confirmation.
10. Self-healing is hybrid: the system may diagnose, verify, and prepare repair proposals automatically, but admin confirmation is required before writes or reruns.
11. KR repair writes only verified `provider_resolution_mappings` plus enqueues backfills. Do not bulk mark unsupported/delisted in v1.
12. Twelve Data KR catalog evidence should drive deterministic Yahoo suffix hints: `KRX/XKRX -> .KS`, `KOSDAQ/XKOS -> .KQ`; Yahoo verification is still required before persisting.
13. `YahooFinanceKrMarketDataProvider` consults durable mappings before probing. Probing remains fallback and repair evidence, not the primary steady-state path.
14. Admin Settings owns guardrail thresholds: dangerous match threshold, preview sample limit, UI page size, auto-pause failure threshold per minute, and preview token TTL.
15. Do not add provider rate-cap editing in this scope unless already available; display effective provider caps only.
16. Provider Fixer UI should follow `41-admin-provider-fixer-light.png`: diagnostics, staged operation panel, guarded bulk controls, active operations, logs, and evidence table.

## Implementation Steps

- [x] Add migrations for `provider_operations`, `provider_operation_logs`, and `provider_resolution_mappings`.
- [x] Add Admin Settings columns/config for Provider Fixer thresholds with server-side bounds, reset support, audit logging, and UI rows using the existing numeric override pattern.
- [x] Extend KR catalog persistence so Twelve Data `exchange` / `mic_code` evidence is not discarded before Yahoo binding can use it.
- [x] Add persistence methods for provider operations, operation logs, mapping lookup/upsert, active-operation checks, and paginated unresolved/error queries.
- [x] Add Provider Fixer API routes for summary, diagnostics, preview, stage, execute, pause, resume, cancel, operations, and logs.
- [x] Implement preview-token hashing, snapshot hash generation, sample limits, expiry validation, and typed-confirmation validation.
- [x] Implement KR mapping proposal flow: unresolved Yahoo KR symbols -> Twelve Data catalog evidence -> candidate Yahoo symbol -> quote/chart verification -> staged proposal.
- [x] Implement confirmed mapping writes to `provider_resolution_mappings` with evidence JSON and actor/timestamp metadata.
- [x] Update `YahooFinanceKrMarketDataProvider` to resolve via durable provider mapping first, then fallback to current `quote_first` / `chart_probe_v1` probing.
- [ ] Update backfill enqueue/worker paths so operation id, resolver mode, provider id, market, batch id, counts, and failure context are logged consistently.
- [ ] Add guarded legacy batch cancel support with preview, typed confirmation, audit, and operation log entries.
- [ ] Add pause/resume/cancel for new operation-backed jobs, including worker-enforced pause checks and active-operation state transitions.
- [x] Replace inline `/admin/providers` rerun controls with read-only health rows and `Open fixer` links.
- [ ] Build `/admin/provider-fixer` matching the agreed mockup: filterable diagnosis, evidence preview, active operations, staged proposal controls, dangerous confirmation, and paginated logs/results.
- [x] Keep `POST /admin/providers/:providerId/rerun` only as temporary backward-compatible API surface if needed by existing tests; the UI must stop calling it directly.
- [x] Update docs/runbook to remove inline KR resolver instructions and document Provider Fixer operation flow, guardrails, KR binding, and rollback.
- [ ] Update API unit/integration/HTTP tests for operations, settings, mapping writes, guardrails, active-operation blocking, and legacy cancel.
- [x] Update web unit tests for Provider Fixer UI states, confirmation rules, settings rows, and `/admin/providers` read-only behavior.
- [ ] Add/update E2E tests covering Provider Fixer diagnosis, preview, low-risk confirm, dangerous typed confirmation, and `/admin/providers -> Open fixer` navigation.
- [ ] Run the smallest relevant tests first, then the repo-required full gate before PR.

## Open Items

- [x] Decide whether legacy pg-boss pause/resume can be safely supported after implementation discovery; default v1 stance remains legacy cancel only.
- [ ] Implement legacy cancel without stale active-operation locks. Current code intentionally does not expose legacy pg-boss batch cancellation because `refresh_batches` has no cancelled state and running workers cannot be killed safely through the existing worker contract.
- [ ] Add worker-enforced pause/resume semantics for operation-backed long-running work. Current pause/resume/cancel routes update operation rows only.
- [ ] Add E2E coverage and screenshot verification against `41-admin-provider-fixer-light.png`.

## References

- Previous KZO-197 todo: `docs/004-notes/kzo-197/scope-todo-202605091500-locked.md`
- Provider Fixer mockup: `docs/004-notes/ui-reshape-shadcn/mockup-2026060209-admin-provider-fixer.html`
- Light screenshot: `docs/004-notes/ui-reshape-shadcn/screenshots/41-admin-provider-fixer-light.png`
- Current admin provider UI: `apps/web/components/admin/AdminProvidersClient.tsx`
- Current provider rerun route: `apps/api/src/routes/adminRoutes.ts`
- Current KR Yahoo resolver: `apps/api/src/services/market-data/providers/yahooFinanceKr.ts`
- Current Twelve Data KR catalog provider: `apps/api/src/services/market-data/providers/twelveDataKr.ts`
