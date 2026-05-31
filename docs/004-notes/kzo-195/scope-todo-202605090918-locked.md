---
slug: kzo-195
source: scope-grill
created: 2026-05-09
tickets: [KZO-195]
required_reading:
  - docs/004-notes/kzo-195/scope-todo-202605090918-locked.md
superseded_by: null
---

# Todo: KZO-195 — ASX delisting detection (KZO-194 follow-up)

> **For agents starting a fresh session:** read this scope-todo before starting. Cross-reference KZO-194's transition note (`docs/004-notes/kzo-194/transition-202605071600-twelve-data-catalog.md`) for the AU catalog provider context. Linear ticket: <https://linear.app/kzokv/issue/KZO-195>.

## Summary

Implement diff-based delisting detection for AU (capability is market-agnostic; AU-only enabled in this ticket, US flips on via the same flag in a follow-up). Includes consecutive-absence threshold, mass-delisting safety guard, implicit LIC discriminator via origin tracking, admin UNDO + exclusion path, and full audit/notification surface.

## Architecture decisions (locked)

| ID | Decision |
|---|---|
| R1 | Add `readonly supportsDelistingFeed: boolean` to `InstrumentCatalogProvider`. FinMind-TW=`true`; FinMind-US, Yahoo-AU, TD-AU=`false`. Mocks mirror. |
| R2 | Pure function `detectDelistingsByAbsence(prevState, currentTickers, opts) → DetectionPlan` co-located with `runCatalogSync`. |
| R3 | Persistence read of prior state folded into the C1-a callback (no separate `listCatalogTickerStates` method). |
| R4 | Three new columns on `market_data.instruments`: `last_seen_in_catalog_at TIMESTAMP`, `absence_streak INTEGER NOT NULL DEFAULT 0`, `delisting_detection_excluded BOOLEAN NOT NULL DEFAULT FALSE`. |
| R5 | `DelistingRecord` gains `source: "provider_feed" \| "absence_detected"` (optional, default `"provider_feed"`). |
| C1-a | `upsertInstrumentCatalog` grows optional `absenceDetection.categorize` callback bridging the pure detector into the transaction. Backward-compatible — TW path passes no `absenceDetection`. |

## Implementation steps

### Phase 1 — Schema + types
- [x] Migration `db/migrations/049_kzo195_absence_delisting_detection.sql`:
  - Add `last_seen_in_catalog_at TIMESTAMP NULL` to `market_data.instruments`.
  - Add `absence_streak INTEGER NOT NULL DEFAULT 0` to `market_data.instruments`.
  - Add `delisting_detection_excluded BOOLEAN NOT NULL DEFAULT FALSE` to `market_data.instruments`.
  - Backfill: `UPDATE market_data.instruments SET last_seen_in_catalog_at = updated_at WHERE market_code = 'AU' AND is_provisional = FALSE` (only AU; TW/US not in scope).
  - Add 3 columns to `app_config`: `catalog_absence_threshold INT`, `catalog_absence_guard_percent NUMERIC(5,2)`, `catalog_absence_guard_floor INT`.
  - Add audit-log action codes: `instrument_undelete`, `instrument_exclusion_toggle` (verify codes table location; if no FK, just document).
- [x] Extend `DelistingRecord` in `apps/api/src/persistence/types.ts` with optional `source: "provider_feed" | "absence_detected"`.
- [x] Extend `CatalogSyncResult` to `{ upserted, delisted, absent, guardTripped, absentTickers }`.
- [x] Add `readonly supportsDelistingFeed: boolean` to `InstrumentCatalogProvider` interface in `apps/api/src/services/market-data/types.ts`.

### Phase 2 — Provider capability flag (R1)
- [x] `FinMindMarketDataProvider` (TW): `supportsDelistingFeed = true`.
- [x] `FinMindUsStockProvider`: `supportsDelistingFeed = false`.
- [x] `YahooFinanceAuMarketDataProvider`: `supportsDelistingFeed = false`.
- [x] `TwelveDataAuCatalogProvider`: `supportsDelistingFeed = false`.
- [x] Mirror on all four mock providers.

### Phase 3 — Pure detector (R2)
- [x] Create `apps/api/src/services/market-data/detectDelistingsByAbsence.ts` exporting:
  - `interface AbsentRow { ticker: string; absenceStreak: number; lastSeenInCatalogAt: string | null; delistingDetectionExcluded: boolean; }`
  - `interface DetectionOptions { threshold: number; guardPercent: number; guardFloor: number; prevCatalogSize: number; }`
  - `interface DetectionPlan { guardTripped: boolean; toBump: string[]; toStamp: string[]; absentTickers: string[]; }`
  - `function detectDelistingsByAbsence(absent: AbsentRow[], opts: DetectionOptions): DetectionPlan`
- [x] Logic:
  - `candidates` = absent rows with `lastSeenInCatalogAt !== null && delistingDetectionExcluded === false`.
  - `guardTrips = candidates.length > Math.max(opts.guardFloor, opts.prevCatalogSize * opts.guardPercent / 100)`.
  - If `guardTrips`: return `{ guardTripped: true, toBump: [], toStamp: [], absentTickers: candidates.map(r => r.ticker) }`.
  - Else: `toBump = candidates.map(r => r.ticker)`, `toStamp = candidates.filter(r => r.absenceStreak + 1 >= opts.threshold).map(r => r.ticker)`.

### Phase 4 — App config resolvers (mirror KZO-198 pattern)
- [x] `apps/api/src/services/appConfig/catalogAbsence.ts`:
  - `getEffectiveCatalogAbsenceThreshold(): number` (cache → env `CATALOG_ABSENCE_THRESHOLD` → default 3).
  - `getEffectiveCatalogAbsenceGuardPercent(): number` (default 1.0).
  - `getEffectiveCatalogAbsenceGuardFloor(): number` (default 5).
- [x] Add env entries in `libs/config/src/env-schema.ts` (Tier 2 hybrid). Three optional fields with safe defaults — no auto-gen registration needed.
- [x] Wire into `app_config` cache invalidation per `.claude/rules/app-config-cache-coherency.md` (generation counter + PATCH-response bypass).
- [x] Admin settings `PATCH /admin/settings` handler reads/writes the three new fields.

### Phase 5 — Persistence transaction (C1-a + 8a)
- [x] Refactor `PostgresPersistence.upsertInstrumentCatalog` to accept optional `absenceDetection`:
  ```ts
  upsertInstrumentCatalog(
    instruments: CatalogInstrument[],
    providerDelistings: DelistingRecord[],
    options?: {
      absenceDetection?: {
        marketCode: MarketCode;
        categorize: (absent: AbsentRow[], prevCatalogSize: number) => DetectionPlan;
      };
    },
  ): Promise<CatalogSyncResult>;
  ```
- [x] Single-transaction flow:
  1. Bulk UPSERT presents (existing path) + stamp `last_seen_in_catalog_at = NOW()`, `absence_streak = 0` for present rows.
  2. SELECT absent candidates (`market_code = $1 AND last_seen_in_catalog_at IS NOT NULL AND delisting_detection_excluded = FALSE AND last_seen_in_catalog_at < NOW()` — i.e. not just-stamped).
  3. SELECT `prevCatalogSize` (count of AU rows pre-this-run; could derive from same query).
  4. Invoke `categorize(absent, prevCatalogSize)`.
  5. If `plan.guardTripped`: skip both the bump UPDATE and stamp UPDATE. Stamp persistence-side-only audit row capturing the candidate list.
  6. Else: `UPDATE absence_streak += 1` for `plan.toBump`; `UPDATE delisted_at = NOW(), status_reason = 'absence_detected'` for `plan.toStamp`; per-stamped-ticker audit-log row.
  7. COMMIT.
  8. Return `CatalogSyncResult` extended.
- [x] `MemoryPersistence`: parallel implementation honoring same contract (sufficient for service-layer unit tests; integration-level Postgres tests are authoritative per `.claude/rules/test-placement-persistence-backend.md`).

### Phase 6 — runCatalogSync orchestrator
- [x] Branch on `provider.supportsDelistingFeed`:
  - `true` (TW): call `provider.fetchDelistingHistory()` as today; pass to `upsertInstrumentCatalog` with `source: "provider_feed"`; no `absenceDetection`.
  - `false` (AU initially; US flips on later): call `upsertInstrumentCatalog` with `absenceDetection.categorize` wired to `detectDelistingsByAbsence` + the three resolvers.
- [x] Post-commit: if `result.delisted > 0` → fan out admin notification (severity `info`, source `delisting_detector`). If `result.guardTripped === true` → fan out admin notification (severity `warning`, detail includes `absentTickers` truncated to first 50).

### Phase 7 — Admin endpoints (5a + 5b + 5c)
- [x] `POST /admin/instruments/:ticker/:marketCode/undelete` (admin-only via `requireAdmin()`):
  - Clears `delisted_at`, resets `absence_streak = 0`, sets `last_seen_in_catalog_at = NOW()`.
  - Writes audit row with action `instrument_undelete`, before/after payload, actor user id.
  - Returns updated row.
- [x] `POST /admin/instruments/:ticker/:marketCode/exclude` (admin-only):
  - Body: `{ excluded: boolean }`. Toggles `delisting_detection_excluded`.
  - Writes audit row with action `instrument_exclusion_toggle`.
  - Returns updated row.

### Phase 8 — Admin UI page (5a)
- [x] `apps/web/app/admin/instruments/page.tsx` (server component): fetches DTO with paginated AU instruments + their absence/delisting state.
- [x] `apps/web/components/admin/AdminInstrumentsClient.tsx` (client component): table, undelete/exclude actions, status chips.
- [x] Update `apps/web/components/admin/AdminSidebar.tsx` `adminNavItems` with a new entry.
- [x] Update `apps/web/components/admin/AdminShell.tsx` `ADMIN_TITLES` map. **(Per `admin-new-subpage-checklist.md` — easy-to-miss step.)**
- [x] Update `apps/web/components/admin/AdminAuditLogClient.tsx` `ACTION_LABELS` + `ACTION_CATEGORIES` for `instrument_undelete` and `instrument_exclusion_toggle`.
- [x] Read-only display panel showing the three thresholds (link to `/admin/settings`).
- [x] Reference mockup at `docs/004-notes/kzo-195/mockup-202605090918-admin-instruments.png`.

### Phase 9 — Tests (7a + 7b + 7c)
- [x] **Suite 4 (api unit):** `apps/api/test/unit/detectDelistingsByAbsence.test.ts`:
  - Below threshold: streak=2, threshold=3 → no stamp.
  - At threshold: streak=2 + 1 from this run → stamp.
  - Guard trip floor: small catalog (size=10), 6 absent → trips floor (5).
  - Guard trip percent: large catalog (size=1000), 11 absent → trips percent (1.0%).
  - Excluded row: `delisting_detection_excluded=true` → never candidate.
  - LIC row: `lastSeenInCatalogAt=null` → never candidate.
- [x] **Suite 5 (Postgres integration):** `apps/api/test/integration/auCatalogDelistingDetector.integration.test.ts`:
  - Real-delisting case: 3-run streak → `delisted_at` stamped, audit row written.
  - Mass-delisting safety: trip → upserts committed, no streak bump, no stamp, admin notification queued.
  - LIC absence: row with `last_seen_in_catalog_at IS NULL` never gets candidate-flagged.
  - Reversal: undelete clears `delisted_at`, resets streak, sets `last_seen_in_catalog_at`. Exclude flips flag.
  - Per `integration-test-persistence-direct.md`: use `PostgresPersistence` directly with managed test DB.
  - Use `AUDEL01`, `AUDEL02`, ... synthetic prefix per ticker hygiene rule.
- [x] **Suite 8 (api HTTP, AAA):** `apps/api/test/http/specs/admin-instruments-aaa.http.spec.ts` covering undelete + exclude endpoints (admin success path, non-admin 403).
  - Register endpoint class in `libs/test-api/src/config/mapper.ts` (per `test-api-mapper-registration.md`).
- [x] **Suite 7 (OAuth E2E, AAA):** `apps/web/tests/e2e/specs-oauth/admin-instruments-aaa.spec.ts`:
  - POM: `libs/test-e2e/src/pages/admin/AdminInstrumentsPage.ts`.
  - Assistant: `libs/test-api/src/assistants/admin/AdminInstrumentsApiAssert.ts`.
  - Smoke: page loads, table renders, undelete button visible for delisted rows.
  - Pre-PR: run `/aaa` skill to generate the AAA scaffolding cleanly.

### Phase 10 — Wave-2 documentation
- [x] Transition note `docs/004-notes/kzo-195/transition-202605091700-asx-delisting-detection.md` (datetime updated when written) covering: capability flag pattern, schema additions, threshold tuning playbook, undelete/exclude UX walkthrough.
- [x] PR description draft `.worklog/team/pr-description-draft.md` with sections per `.claude/rules/pr-bound-docs-review-compliance.md`: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback`, behavioral-deltas table, renamed-types table.
- [x] Update `docs/002-operations/runbook.md`: add a "Mass-delisting guard tripped" runbook entry (link to `/admin/instruments`, threshold tuning steps, when to undelete vs. exclude).
- [x] Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`: add `AUDEL*` prefix to the AU reservation list.
- [x] Update `docs/001-architecture/` (assumed `market-data.md` or similar): brief paragraph on diff-detector capability + provider-flag pattern, distinguishing from TW's provider-feed path.
- [x] Verify `e2e-shared-memory-bars-ticker-hygiene.md`'s in-line comments in any test file that references `AUDEL*` are kept consistent.

## Open items

None. All design questions resolved during the grill. Non-criticals N1–N10 from Phase 1.5 carry forward as documentation tasks (above) or are out-of-scope per the locked decisions.

## Out of scope (explicit)

- US delistings (capability flag ready; flip-on is a follow-up — change `FinMindUsStockProvider.supportsDelistingFeed = true` and tune US-specific thresholds).
- TW behavior unchanged (provider-feed path retained).
- Yahoo-AU delistings (Yahoo only owns bars/dividends/metadata in AU; TD owns catalog).
- Real-data integration test against TD's actual `/stocks` response.
- Recovery / "guard reset" notifications.
- AU calendar gating on streak counters (deferred; the 1% mass guard absorbs holiday-induced anomalies).

## References

- Linear: <https://linear.app/kzokv/issue/KZO-195>
- Parent ticket: KZO-194 (TD AU catalog ingestion)
- Mockup: `docs/004-notes/kzo-195/mockup-202605090918-admin-instruments.png` (TBD — pending background generation)
- Companion rules:
  - `.claude/rules/migration-strategy.md`
  - `.claude/rules/admin-new-subpage-checklist.md`
  - `.claude/rules/test-placement-persistence-backend.md`
  - `.claude/rules/integration-test-persistence-direct.md`
  - `.claude/rules/test-api-mapper-registration.md`
  - `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`
  - `.claude/rules/app-config-cache-coherency.md`
  - `.claude/rules/fastify-app-config-bootstrap.md`
  - `.claude/rules/env-setup-autogen-required-secrets.md`
  - `.claude/rules/pr-bound-docs-review-compliance.md`
  - `.claude/rules/full-test-suite.md` (8-suite gate)
- KZO-194 reference: `docs/004-notes/kzo-194/transition-202605071600-twelve-data-catalog.md`
- KZO-198 reference (Tier-2 hybrid pattern): `docs/004-notes/kzo-198/`

## Agent post-implementation step

After implementation, the implementing agent (e.g. `/solo-dev`, `/team`) MUST tick each `[ ]` checkbox above (`- [x]`) whose deliverable was actually shipped. Items left unchecked signal scope agreed-but-not-delivered.

## Delivery notes (2026-05-09)

All checkboxes ticked. Implemented by Tier 3 `/team` (kzo-195-asx-delisting) across 9 convergence iterations. Notable architectural divergence from the locked design:

- **Phase 6 gate evolved.** The locked design said "branch on `provider.supportsDelistingFeed`" with the false-side enabling absence detection. A Codex review at iter 9 caught that this polarity meant `FinMindUsStockProvider` (also `supportsDelistingFeed=false`) would silently absence-detect US — violating R1's "AU only enabled here, US flips on later." Replaced with an explicit second capability flag `absenceDetectionEnabled: boolean` (true on TD-AU only). Three-way gate: `supportsDelistingFeed` → `absenceDetectionEnabled` → bare upsert. Future US/Yahoo-AU enablement = flip the corresponding provider's `absenceDetectionEnabled = true`. See transition note for details.
- **AAA framework path.** Senior QA delivered `libs/test-api/src/endpoints/AdminInstrumentsEndpoint.ts` (flat) + `libs/test-api/src/assistants/adminInstruments/` (sibling subfolder) instead of the locked `endpoints/admin/...` + `assistants/admin/...` paths, to avoid colliding with the existing `assistants/admin/AdminApiAssert.ts`. Mapper registration intact.
- **9-iteration convergence.** See transition note (`transition-202605092200-asx-delisting-detection.md`) for the full iteration log including iter 5's hard-ceiling decision, iter 6's tooltips-a11y fix, iter 7's surfacing of real KZO-195 bugs, iter 8's _seedInstrument mirror correction, and iter 9's Codex-driven architectural pivot.
