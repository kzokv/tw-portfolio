# Latest Handoff

## Completed
- Replaced fee-profile `commissionDiscountBps` with `commissionDiscountPercent` across shared types, domain types, API routes, persistence, settings UI, and tests.
- Changed fee semantics so runtime storage/API now use percent-off, and fee math applies `1 - commissionDiscountPercent / 100`.
- Added locale-aware settings behavior:
  - English edits `% off`
  - `zh-TW` edits `折`
  - frontend converts between `折` and percent-off while DB/API remain percent-off
- Added Postgres migration `008_commission_discount_percent.sql` to backfill `commission_discount_percent` from legacy `commission_discount_bps`.
- Kept persistence compatibility for legacy DB rows and fee snapshots by normalizing older shapes on read.
- Verified with `npm run build`, `npm run test -w libs/domain`, `npm run test:unit -w apps/web`, `npm run test:integration -w apps/api`, `npm run test:integration:ci:host`, and the focused Playwright spec for settings fee-profile bindings on March 11, 2026.

## Decisions
- Runtime source of truth for broker discount is percent-off, not multiplier percent and not `折`.
- `zh-TW` UI may display/edit `折`, but API/DB continue to store percent-off.
- Conversion rule is:
  - `折 = (100 - commissionDiscountPercent) / 10`
  - `commissionDiscountPercent = 100 - 折 * 10`

## Next steps
- If this behavior should be treated as a long-lived product contract, promote it into a dedicated ADR.
- When committing, anchor the work to a Linear ticket or use the repo waiver path if no ticket applies.

## Risks or blockers
- Future contributors may reintroduce the multiplier-vs-percent-off ambiguity unless the decision is documented outside the handoff.
- The DB still retains legacy `commission_discount_bps` compatibility paths in persistence; cleanup should be deliberate rather than incidental.

## Open questions
- Whether to keep the legacy `commission_discount_bps` compatibility path indefinitely or remove it in a later cleanup.

## Relevant files
- `db/migrations/008_commission_discount_percent.sql`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/src/routes/registerRoutes.ts`
- `libs/domain/src/fee.ts`
- `apps/web/features/settings/components/FeeProfilesSection.tsx`
- `apps/web/features/settings/services/commissionDiscount.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
