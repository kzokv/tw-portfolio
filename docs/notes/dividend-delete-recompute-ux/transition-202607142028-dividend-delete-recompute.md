# Dividend deletion and recompute history transition

Date: 2026-07-14

## Delivered behavior

- Recompute History is a two-step reviewed operation. It defaults to `KEEP_RECORDED`; users may explicitly select `RECALCULATE_CALCULATED`.
- Both modes replay complete deterministic accounting history. Only the recalculation mode changes booked fee amounts, and only for `CALCULATED` trades. Commission and transaction tax change together; `MANUAL` and `SOURCE_PROVIDED` remain unchanged.
- Previews include native-currency counts/deltas, a fee-configuration fingerprint, a complete preview fingerprint, and expiry. Drift or expiry refreshes the review and requires another explicit confirmation.
- Confirmation compare-and-sets the durable job to `RUNNING`, simulates every selected scope, and atomically persists the selected core accounting plus `CONFIRMED`. Holding and wallet snapshots are scheduled only after that commit.
- Transaction deletion keeps the reviewed impact visible, shows `Deleting…`, blocks duplicate confirmation and dismissal, and refreshes stale destructive previews without auto-confirming.
- Dividend Review explains how generated expectations and posted facts are removed or corrected. Its action opens the related ticker's Transactions tab while retaining `marketCode` and `accountId`; it does not expose direct dividend deletion.

## Database rollout

Migration `104_dividend_delete_recompute_history.sql` is required before the new application is served. It:

- expands trade fee provenance with `SOURCE_PROVIDED`;
- adds recompute mode, lifecycle, expiry, revision, and fingerprint fields;
- adds per-item currency, provenance, and applied-profile audit fields;
- removes the `recompute_job_items.trade_event_id` foreign key while retaining the id as historical metadata.

The last point is intentional. Scoped replay rewrites canonical trade rows, and later user-authorized deletion may remove them. A cascading FK would erase confirmed review/audit items during either operation. Managed-Postgres acceptance verifies those items survive a real replay commit.

Migration 104 is forward-oriented. Rolling the application back after the migration requires a compatibility migration because the prior application cannot populate every new required job field. Before restoring the old item FK, operators must also handle historical item rows whose source trade no longer exists. Preserve a database backup and recompute audit export before any schema rollback.

## Validation evidence before final rebase

| Check | Result |
| --- | --- |
| Focused API service/route/persistence/MCP tests | 4 files, 63 tests passed |
| Focused web hook/component/service/page tests | 8 files, 89 tests passed |
| Focused AAA Playwright (`recompute-history`, `dividend-delete-recovery`, `dividend-removal-guidance`) | 12 passed across desktop/mobile; no failures or retries |
| ESLint | exit 0; 36 existing warnings, 0 errors |
| Typecheck | exit 0 |
| Managed Postgres integration (`npm run test:integration:full:host`) | 102/102 files passed; 1,029 passed, 1 skipped; 1,988.19 seconds |

The final eight repository gates must be repeated after rebasing onto the latest `origin/dev`; record those results below before merge.

## Final post-rebase gates

All eight repository gates were repeated after rebasing onto
`b969a64c7135091a5ec276f0751ad89ae5feb2e1` (`origin/dev` at validation time).

| Gate | Result |
| --- | --- |
| `npx eslint .` | exit 0; 0 errors, 36 existing warnings |
| `npm run typecheck` | exit 0 |
| `npm run test --prefix apps/web` | 158 files passed; 1,089 tests passed |
| `npm run test --prefix apps/api` | 200 files passed, 48 skipped; 2,054 tests passed, 467 skipped |
| `npm run test:integration:full:host` | 102 files passed; 1,029 tests passed, 1 skipped; 1,981.09 seconds |
| `npm run test:e2e:bypass:mem --prefix apps/web` | 395 passed, 19 skipped; 19.2 minutes |
| `npm run test:e2e:oauth:mem --prefix apps/web` | 121 passed; 4.9 minutes |
| `npm run test:http --prefix apps/api` | 306 passed, 2 skipped; 59.9 seconds |

The first OAuth E2E attempt had one pre-existing drag-and-drop hang in
`[transactions-A]` after 118 passing tests. The exact case passed immediately
when isolated (3.7 seconds), and the required complete command was then repeated
successfully with all 121 tests passing; no product or test code was changed for
the transient failure.
