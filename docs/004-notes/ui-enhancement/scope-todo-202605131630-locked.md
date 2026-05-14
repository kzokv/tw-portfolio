---
slug: ui-enhancement
source: scope-grill
created: 2026-05-13
tickets: []
required_reading: []
superseded_by: null
---

# Todo: UI enhancement — account deletion, fee/tax field gating, market chip cleanup

> **For agents starting a fresh session:** read this file end-to-end before starting. No debate note exists; scope was locked directly via interrogation. All decisions are embedded below.

## Locked Scope Summary

### Item 1 — Account deletion (two-stage, soft + scheduled hard-purge)

1. Two-stage model: soft delete (sets `accounts.deleted_at`) → scheduled hard purge after grace period via cron.
2. Grace period: **30 days** default. Admin-tunable via Settings → Tier-B `app_config` (`accountHardPurgeDays`). Cron schedule env-only.
3. Skip-wait shortcut: "Permanently delete now" with typed-name confirmation (mirror `hardPurgeUser` admin precedent).
4. Pre-conditions: none block. Confirmation modal warns on open positions, non-zero cash, last-account state.
5. Confirmation flow: tiered — soft = one-click modal; permanent = typed-name + button.
6. Hide scope: every account-scoped read path filters by `WHERE accounts.deleted_at IS NULL`.
7. Restore surface: inline "Recently deleted (N)" section in Settings → Accounts.
8. Name handling: name free for reuse after soft-delete; on restore, auto-rename `"{name} (restored)"` if collision.
9. Audit codes: `account_soft_deleted`, `account_restored`, `account_hard_purged`.
10. SSE events: same three keys.
11. Cascade order (hard purge): mirror `hardPurgeUser` (`apps/api/src/persistence/postgres.ts:7463+`).
12. Snapshot policy: filter-on-read; do not recompute historical snapshots.
13. MemoryPersistence parity for all new methods.

### Items 2 & 3 — Fee/tax field rendering

14. Render gate: change from `feeEstimate ?` to **4-tuple** `accountId && ticker && quantity > 0 && unitPrice > 0`.
15. Estimate label degrades to "—" when null in rendered state.
16. Override input always present + editable once section renders. Existing empty-input semantic preserved.
17. Override persists across input changes; no auto-clear.
18. Price-mismatch branch (`useTransactionSubmission.ts:132`) keeps section rendered.
19. Tax field stays SELL-only.

### Item 4 — Remove "ALL" market chip

20. Drop `null` from `MARKET_CHIPS` in `AddTransactionCard.tsx:30`. Settings catalog browser keeps ALL.
21. Default chip selection: selected account's market.
22. Chip remains user-changeable (one-way binding: account → chip).
23. On account change: chip auto-syncs + ticker field clears.
24. Internal "ALL" defaults preserved in hooks/services.

### Cross-cutting

25. New env vars: `ACCOUNT_HARD_PURGE_CRON` (`.default("0 4 * * *")`), `ACCOUNT_HARD_PURGE_DAYS` (`.default(30)`).
26. New `app_config` column: `account_hard_purge_days INT NULL` with `getEffectiveAccountHardPurgeDays()` resolver.
27. Migrations: new sequential files; do not edit applied migrations.
28. Tests: full 8-suite gate (lint, typecheck, web unit, api unit, integration:full:host, e2e bypass mem, e2e oauth mem, http api).
29. Reserved E2E tickers: pick unused per `e2e-shared-memory-bars-ticker-hygiene.md`.
30. Commit/PR: per `commit-format.md`. Either create Linear ticket or use `waiver:linear-ticket` label + `## Waiver` section.

---

## Implementation Steps

### Schema & config
- [x] Migration: add `accounts.deleted_at TIMESTAMPTZ NULL` column (new sequential migration; never edit applied migrations per `migration-strategy.md`)
- [x] Migration: add `app_config.account_hard_purge_days INT NULL` column
- [x] Env vars: `ACCOUNT_HARD_PURGE_CRON` (`.default("0 4 * * *")`) + `ACCOUNT_HARD_PURGE_DAYS` (`.default(30)`) in `libs/config/src/env-schema.ts`
- [x] App-config resolver: `getEffectiveAccountHardPurgeDays()` wired into the app_config cache pattern (eager pre-warm + generation counter + PATCH-response bypass per `app-config-cache-coherency.md` and `fastify-app-config-bootstrap.md`)

### Persistence layer
- [x] `PostgresPersistence`: `softDeleteAccount(id, userId)`, `restoreAccount(id, userId, { autoRenameOnCollision })`, `hardPurgeAccount(id, userId)`, `listSoftDeletedAccounts(userId)`
- [x] `MemoryPersistence` parity for the four methods (mirror the user-purge cascade pattern)
- [x] Audit-log helpers: `account_soft_deleted`, `account_restored`, `account_hard_purged` (snapshot account_name into payload before deletion)
- [x] Add `WHERE accounts.deleted_at IS NULL` to every account-scoped read path: account list, dashboard totals, portfolio aggregate, cash ledger, dividend ledger, recent transactions, snapshot reads, share view aggregates
- [x] Snapshot policy: filter-on-read for historical snapshots — do NOT recompute past `daily_portfolio_snapshots` / `currency_wallet_snapshots` on delete/restore

### API routes (use `routeError` per `service-error-pattern.md`)
- [x] `DELETE /accounts/:id` → soft-delete + audit + SSE `account_soft_deleted`
- [x] `POST /accounts/:id/restore` → restore w/ auto-rename on active-name collision + audit + SSE `account_restored`
- [x] `POST /accounts/:id/purge` → hard-purge w/ typed-name confirmation token + audit + SSE `account_hard_purged` (mirror `hardPurgeUser` confirmation token shape from `adminRoutes.ts:440+`)
- [x] `GET /accounts/deleted` (or extend the existing list endpoint) for the "Recently deleted" UI section

### Cron worker
- [x] `accountHardPurgeWorker`: selects `accounts` where `deleted_at < NOW() - INTERVAL N days` (N from resolver, live-tunable) and hard-purges each in its own transaction
- [x] Register cron in app startup; emit `account_hard_purged` SSE per account purged
- [x] Composite singleton-key on any per-account boss.send calls per `pgboss-composite-singleton-key.md`

### SSE event types
- [x] Add `account_soft_deleted`, `account_restored`, `account_hard_purged` to `libs/shared-types/src/events.ts` (or equivalent)
- [x] Audit Turbopack value-export surface if the shared-types barrel transitions per `shared-types-barrel-turbopack.md`
- [x] Web subscribes via existing `useEventStream` (always-on, per `react-useEventStream-preconnect-pattern.md`)

### Web UI — deletion flows (Item 1)
- [x] `AccountsListSection.tsx`: add "Delete account" button per account row
- [x] Soft-delete confirmation modal: one-click + warnings on open positions / non-zero cash / last-account
- [x] Permanent-delete typed-name confirmation modal (mirror admin purge UX)
- [x] "Recently deleted (N)" subsection below active accounts: Restore + "Permanently delete now" + time-remaining indicator per row
- [x] I18n additions for all delete/restore/purge labels, modals, and warnings (flat strings per `i18n-flat-record-dict-settings.md`, no functions per `nextjs-i18n-serialization.md`)

### Web UI — fee/tax render fix (Items 2 & 3)
- [x] Change render gate at `apps/web/components/portfolio/AddTransactionCard.tsx:530` from `feeEstimate ?` to `(value.accountId && value.ticker && value.quantity > 0 && value.unitPrice > 0) ?`
- [x] Add `dict.transactions.estimatedUnavailable` ("—") + sub-label "estimate unavailable" i18n entries (flat string, no functions)
- [x] Verify `useTransactionSubmission.ts:132` price-mismatch branch keeps the section rendered (estimate becomes null, but 4-tuple still holds)
- [x] Tax field stays SELL-only (unchanged); preserve `value.type === "SELL"` conditional

### Web UI — ALL chip removal (Item 4)
- [x] `AddTransactionCard.tsx:30`: change `MARKET_CHIPS` from `["TW", "US", "AU", null]` to `["TW", "US", "AU"]`
- [x] `AddTransactionCard.tsx:284`: drop the `chip ?? "ALL"` fallback (only `MarketCode` literals remain)
- [x] Account-change effect: auto-sync `marketChip` to `account.marketCode` + clear `ticker` field
- [x] Default initial chip selection: first account's market (TW fallback for zero-account state)
- [x] Keep internal "ALL" defaults intact: `useInstrumentCatalog.ts:54`, `InstrumentCombobox.tsx:56`, `portfolioService.ts` cross-market query — NOT user-facing
- [x] Settings → Tickers → Catalog browser (`InstrumentCatalogSheet.tsx`) keeps ALL — out-of-scope for this PR

### Tests (8-suite gate per `full-test-suite.md`)
- [x] Unit (`apps/api/test/unit/`): new memory + postgres persistence methods (memory first per `test-placement-persistence-backend.md`)
- [x] Integration (`apps/api/test/integration/`, real-postgres via `describePostgres`): cascade hard-purge ordering, grace-window filtering, restore name-collision auto-rename — use `PostgresPersistence` directly, not `buildApp({ persistenceBackend: "postgres" })` per `integration-test-persistence-direct.md`
- [x] Integration: cron retention test using raw `INSERT ... VALUES (..., NOW() - INTERVAL '40 days')` per `integration-test-persistence-direct.md` (retention/purge crons section); include terminality regression-guard row
- [x] HTTP (`apps/api/test/http/`, AAA framework): DELETE /accounts/:id, POST /accounts/:id/restore, POST /accounts/:id/purge — register endpoints in `libs/test-api/src/config/mapper.ts` per `test-api-mapper-registration.md`
- [x] Web unit (`apps/web/test/`): `AccountsListSection` delete affordance, confirmation modals, "Recently deleted" section
- [x] Web unit: `AddTransactionCard` fee/tax always-visible after 4-tuple; market chip without ALL
- [x] E2E (`specs-oauth/`): delete → restore → permanently-delete flow; use `seedAsBrowser` per `e2e-oauth-seed-as-browser.md`
- [x] E2E: fee/tax fields visible whenever 4-tuple is set (including the price-mismatch race)
- [x] E2E: market chip auto-syncs to account market; ALL no longer rendered
- [x] Reserved E2E tickers: pick unused codes per `e2e-shared-memory-bars-ticker-hygiene.md` (suggest a new prefix like `ACCDEL*` for account-deletion fixtures)
- [x] Page-object updates: any new locators added to `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts` must have matching `data-testid` in source per `playwright-page-object-testid-drift.md`
- [x] Architect locks testid strings in `architect-design.md` upfront per `agent-team-workflow.md` "Lock testid strings"
- [x] Run `/aaa` to author AAA-framework E2E coverage for delete-restore-purge flows + form behavior verifications

### Docs
- [x] Update `docs/002-operations/runbook.md` with cron + grace-period operational notes (no stale "future candidate" left behind per `doc-stale-forward-notes.md`)
- [x] Architecture note for soft-delete lifecycle (account.deleted_at semantics, restore window, cascade pattern)
- [x] Transition note at `docs/004-notes/ui-enhancement/transition-{datetime}.md` (frozen post-merge)
- [x] PR description draft at `.worklog/team/pr-description-draft.md` with `## Problem` / `## Solution` / `## Testing` (Evidence:) / `## Risk/Rollback` per `pr-bound-docs-review-compliance.md`

### PR hygiene
- [x] **Decide before PR**: create a Linear ticket (recommended), OR open the PR with `waiver:linear-ticket` label + literal `## Waiver` section per `commit-format.md` waiver schema
- [x] Pre-push gate: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`
- [x] Verify worktree rebuild between source edits per `playwright-web-bundle-rebuild.md` when iterating on E2E

## Open Items
- [x] Linear ticket creation vs waiver path (decide before PR open)

## References
- Source files inspected during scope grill:
  - `apps/web/features/settings/components/AccountsListSection.tsx` (no delete affordance)
  - `apps/web/components/portfolio/AddTransactionCard.tsx:30,284,530` (chip + fee gate)
  - `apps/web/features/portfolio/hooks/useTransactionSubmission.ts:71-193` (estimate logic)
  - `apps/api/src/routes/registerRoutes.ts:2920+` (POST/PATCH accounts, no DELETE)
  - `apps/api/src/persistence/postgres.ts:7463+` (`hardPurgeUser` cascade precedent)
- Live verification: https://twp-dev-web.kzokvdevs.dpdns.org/dashboard?drawer=settings + /transactions
- Linear tickets: none — see Open Items
