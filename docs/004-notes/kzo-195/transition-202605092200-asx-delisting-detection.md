---
slug: kzo-195
type: transition-note
created: 2026-05-09T22:00
tickets: [KZO-195]
parent: KZO-194
status: frozen
---

# Transition Note — KZO-195: ASX Delisting Detection

This is a frozen snapshot of the system state at the time KZO-195 merged. Do not edit after merge.

---

## 1. Capability Flag Taxonomy

KZO-195 introduces a **three-way capability gate** replacing the prior binary approach. Each `InstrumentCatalogProvider` now carries two orthogonal boolean flags:

| Flag | Type | Meaning |
|---|---|---|
| `supportsDelistingFeed` | `boolean` | Provider delivers explicit delisting records (feed-class: provider enumerates removed tickers). |
| `absenceDetectionEnabled` | `boolean` | Provider participates in diff-class absence detection (presence of a row in the prior catalog → absence in the new catalog → streak counter incremented). |

A provider with both flags `false` performs a **bare upsert only** — instruments appear in the DB when the catalog says they do; nothing is marked delisted automatically.

### Provider flag matrix

| Provider | `supportsDelistingFeed` | `absenceDetectionEnabled` | Routing |
|---|---|---|---|
| `TwelveDataAuCatalogProvider` (TD-AU) | `false` | `true` | Branch 2 — AU absence detection |
| `FinMindMarketDataProvider` (TW) | `true` | `false` | Branch 1 — provider-feed path |
| `FinMindUsStockMarketDataProvider` (US) | `false` | `false` | Branch 3 — bare upsert |
| `YahooFinanceAuMarketDataProvider` (Yahoo-AU) | `false` | `false` | Branch 3 — bare upsert |

Mock providers mirror their real siblings exactly (verified in iter 9 capability-flag review).

### `runCatalogSync` 3-way gate

```
if (provider.supportsDelistingFeed) {
  // Branch 1: TW — call fetchDelistingHistory(); source = "provider_feed"
} else if (provider.absenceDetectionEnabled) {
  // Branch 2: TD-AU — upsertInstrumentCatalog with absenceDetection callback
} else {
  // Branch 3: US / Yahoo-AU — upsertInstrumentCatalog with no absenceDetection
}
```

Branch 3 never stamps `last_seen_in_catalog_at` or bumps `absence_streak` — US and Yahoo-AU instruments are never auto-delisted by this logic.

### Future US enablement path

To enable absence detection for US stocks: set `FinMindUsStockMarketDataProvider.absenceDetectionEnabled = true` and mirror on `MockFinMindUsStockMarketDataProvider`. No persistence changes required — the `upsertInstrumentCatalog` path already handles any `marketCode`. Tune US-specific thresholds (see §4) before enabling.

---

## 2. Schema Additions

### Migration: `049_kzo195_absence_delisting_detection.sql`

**Three new columns on `market_data.instruments`:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `last_seen_in_catalog_at` | `TIMESTAMP NULL` | `NULL` | Timestamp of the most recent catalog run in which this instrument appeared. `NULL` = never seen (LIC / manually-added instruments). |
| `absence_streak` | `INTEGER NOT NULL` | `0` | Consecutive catalog-sync runs in which this instrument was absent. Reset to `0` when the instrument re-appears. |
| `delisting_detection_excluded` | `BOOLEAN NOT NULL` | `FALSE` | Admin-set exclusion flag. Excluded instruments are never bumped, stamped, or counted in `absentTickers`. |

**Backfill:** `last_seen_in_catalog_at` is backfilled from `updated_at` for existing AU instruments with `is_provisional = FALSE`. TW/US rows are left `NULL` (outside the AU detection scope).

**Three new columns on `app_config` (Tier 1 — admin-editable):**

| Column | Env var | Default | Purpose |
|---|---|---|---|
| `catalog_absence_threshold` | `CATALOG_ABSENCE_THRESHOLD` | `3` | Consecutive absences before `delisted_at` is stamped. |
| `catalog_absence_guard_percent` | `CATALOG_ABSENCE_GUARD_PERCENT` | `1.0` | Mass-delisting guard: if more than this percentage of the prior catalog is absent in one run, skip all bumps and stamps. |
| `catalog_absence_guard_floor` | `CATALOG_ABSENCE_GUARD_FLOOR` | `5` | Minimum number of absent instruments that triggers the mass-delisting guard (protects against a tiny catalog where 1% rounds to 0). |

**Audit log action codes added (CHECK constraint extended on `audit_log_action_check`):**
- `instrument_undelete` — emitted when an admin clears `delisted_at` + resets streak via `POST /admin/instruments/:ticker/:marketCode/undelete`.
- `instrument_exclusion_toggle` — emitted when an admin flips `delisting_detection_excluded` via `POST /admin/instruments/:ticker/:marketCode/exclude`.

---

## 3. Detection Logic (`detectDelistingsByAbsence`)

Pure function in `apps/api/src/services/market-data/detectDelistingsByAbsence.ts`:

```ts
function detectDelistingsByAbsence(absent: AbsentRow[], opts: DetectionOptions): DetectionPlan
```

**Inputs:**
- `absent` — rows from `upsertInstrumentCatalog`'s absence SELECT: instruments with `last_seen_in_catalog_at IS NOT NULL AND delisting_detection_excluded = FALSE AND last_seen_in_catalog_at < NOW()` (not just-stamped by this run).
- `opts.threshold` — effective `catalog_absence_threshold`.
- `opts.guardPercent` / `opts.guardFloor` — effective guard parameters.
- `opts.prevCatalogSize` — count of AU rows prior to this sync run.

**Guard trip condition:**
```
candidates.length > Math.max(opts.guardFloor, opts.prevCatalogSize × opts.guardPercent / 100)
```

**If guard trips:** return `{ guardTripped: true, toBump: [], toStamp: [], absentTickers: candidates.map(r => r.ticker) }`. The persistence layer commits the presence-upserts but skips all streak bumps and delistings.

**If guard does not trip:**
- `toBump` = all candidates (streak += 1 for each).
- `toStamp` = candidates where `absenceStreak + 1 >= opts.threshold` (delisted_at stamped, `status_reason = 'absence_detected'`).

**LIC / manually-added instrument invariant:** rows with `last_seen_in_catalog_at IS NULL` are never candidates. This preserves LICs that Twelve Data's bulk endpoints do not include — they will never be auto-delisted.

---

## 4. Threshold Tuning Playbook

Thresholds are Tier 1 constants: admin-editable at `/admin/settings` (Catalog Absence section) or via env vars (override env var → restart).

### Env var reference

| Env var | Default | Valid range | When to change |
|---|---|---|---|
| `CATALOG_ABSENCE_THRESHOLD` | `3` | `1–365` | Reduce to 1 for fast-delisting markets; increase if Twelve Data API has frequent transient outages causing false positives. |
| `CATALOG_ABSENCE_GUARD_PERCENT` | `1.0` | `0.1–50.0` | Increase if legitimate bulk delistings (e.g. exchange suspension events) keep tripping the guard. Keep low to catch erroneous API responses. |
| `CATALOG_ABSENCE_GUARD_FLOOR` | `5` | `1–100` | The floor prevents the guard from never-tripping on a tiny catalog. Increase if even 5 absent instruments in a small test environment is noise. |

### Admin UI path

1. Navigate to **`/admin` → Settings**.
2. Scroll to **Catalog Absence** section.
3. Edit threshold, guard percent, or guard floor.
4. Click **Save**. The cache invalidates; the next catalog-sync run uses the new values (TTL ≤ 8 s for in-flight runs).
5. To restore env-default: click **Reset to default (NULL)**.

### Audit trail

Every `/admin/settings` PATCH writes an `audit_log` row with `action = 'app_config_updated'` and `metadata.before`/`metadata.after` values. Filter at `/admin/audit-log`.

### Env-vs-DB precedence

Resolver order: DB column (non-NULL) → env var → hard-coded default. Setting the DB column to `NULL` (via Reset button) activates the env-var tier.

---

## 5. Admin Instruments UI

### Navigation

`/admin` → **Instruments** (new sidebar entry).

### Page behavior

The `/admin/instruments` server component fetches a paginated list of `market_data.instruments` rows for `market_code = 'AU'`, including all delisting/absence state. The `AdminInstrumentsClient` renders:

| Column | Description |
|---|---|
| Ticker | ASX ticker symbol |
| Name | Instrument name |
| Type | STOCK / ETF |
| Status | Active / Delisted (with `delisted_at` date) |
| Streak | `absence_streak` counter |
| Last Seen | `last_seen_in_catalog_at` timestamp |
| Excluded | `delisting_detection_excluded` toggle |
| Actions | Undelete / Exclude buttons (admin-only) |

A read-only panel at the bottom of the page shows the current effective threshold values with a link to `/admin/settings`.

### Undelete flow

When an operator believes an instrument was auto-delisted in error:

1. Navigate to `/admin/instruments`.
2. Locate the ticker (filter by Status: Delisted).
3. Click **Undelete**.
4. The API calls `POST /admin/instruments/:ticker/:marketCode/undelete`:
   - Clears `delisted_at`.
   - Resets `absence_streak = 0`.
   - Sets `last_seen_in_catalog_at = NOW()`.
   - Writes an `instrument_undelete` audit row.
5. The instrument reappears as Active on the next page refresh.

**When to undelete:** when the instrument is believed still-active but Twelve Data temporarily excluded it (transient API gap, not a real delisting). If the instrument truly left the exchange, do not undelete — let the delisting stand.

### Exclude flow

To prevent repeated false-positive delistings for a specific instrument (e.g. a LIC that Twelve Data occasionally drops):

1. Navigate to `/admin/instruments`.
2. Click the **Exclude** toggle for the instrument.
3. The API calls `POST /admin/instruments/:ticker/:marketCode/exclude` with `{ excluded: true }`.
4. The instrument's `delisting_detection_excluded` column becomes `TRUE`.
5. From the next catalog-sync run onward, this instrument is never counted in `absentTickers` or bumped/stamped.

**To re-include:** click the toggle again (sends `{ excluded: false }`). An `instrument_exclusion_toggle` audit row is written for both transitions.

**Note on the `absent` metric (L1 transparency):** The `CatalogSyncResult.absent` counter in API logs and admin notification messages counts **all** instruments absent from the current catalog, including excluded ones. The `absentTickers` list (used in admin notifications and guard-trip messages) excludes the excluded instruments. If you see `absent=12` but only 7 tickers in the notification, the delta (5) are excluded instruments — this is expected behavior. See runbook §23 for the operator-facing note.

---

## 6. Admin Notifications

### Instruments auto-delisted (normal path)

**Trigger:** `result.delisted > 0` after a catalog-sync run.
**Severity:** `info`
**Source:** `delisting_detector`
**Message pattern:** `"N ASX instruments auto-delisted (absence-detected): TICKER1, TICKER2, ..."`

Notification fans out to all admin users. Inspect `/admin/instruments` to review the stamped rows or `/admin/audit-log` to see the per-ticker `instrument_undelete` audit trail.

### Mass-delisting guard tripped

**Trigger:** `result.guardTripped === true`.
**Severity:** `warning`
**Source:** `delisting_detector`
**Message pattern:** `"Mass-delisting guard tripped (M absent of N catalog rows). No instruments auto-delisted. Absentees: TICKER1, TICKER2, ... (truncated at 50)"`

No auto-delisting occurs. Operators must manually review whether the guard trip reflects a real exchange event or an API anomaly. See runbook §23 for the investigation and response playbook.

---

## 7. Behavioral Deltas

The following are **intentional changes**, not regressions:

| Surface | Before KZO-195 | After KZO-195 |
|---|---|---|
| `CatalogSyncResult` shape | `{ upserted, delisted }` | `{ upserted, delisted, absent, guardTripped, absentTickers }` |
| `DelistingRecord.source` | Not present | Optional `"provider_feed" \| "absence_detected"` (defaults to `"provider_feed"` for TW) |
| `InstrumentCatalogProvider` interface | No flags | `readonly supportsDelistingFeed: boolean` + `readonly absenceDetectionEnabled: boolean` |
| AU catalog-sync POST-run notifications | None | `info` notification on auto-delisting; `warning` notification on guard-trip |
| `audit_log_action_check` constraint | No instrument action codes | `instrument_undelete`, `instrument_exclusion_toggle` added |
| Admin sidebar | Providers link | Providers + Instruments links |
| `/admin` page titles | No `ADMIN_TITLES["instruments"]` | `"Instruments"` mapped |
| Audit log action labels | No instrument actions | `"Undelete instrument"`, `"Toggle exclusion"` labels added |
| `market_data.instruments` columns | `last_seen_in_catalog_at`, `absence_streak`, `delisting_detection_excluded` absent | All three present post-migration |
| `app_config` columns | No catalog-absence columns | `catalog_absence_threshold`, `catalog_absence_guard_percent`, `catalog_absence_guard_floor` added |
| US / Yahoo-AU catalog sync | No behavior change possible | Still bare upsert (`absenceDetectionEnabled=false`); no streak/delisting activity |

---

## 8. Renamed / Extended Types

| Symbol | Change |
|---|---|
| `DelistingRecord` | `source?: "provider_feed" \| "absence_detected"` field added (optional, backward-compatible) |
| `CatalogSyncResult` | Extended from `{ upserted, delisted }` to `{ upserted, delisted, absent, guardTripped, absentTickers }` |
| `InstrumentCatalogProvider` | `readonly supportsDelistingFeed: boolean` + `readonly absenceDetectionEnabled: boolean` added |
| `AuditLogAction` union | `"instrument_undelete"` and `"instrument_exclusion_toggle"` added |
| `AbsentRow` | New interface: `{ ticker, absenceStreak, lastSeenInCatalogAt, delistingDetectionExcluded }` (local to `detectDelistingsByAbsence.ts`) |
| `DetectionPlan` | New interface: `{ guardTripped, toBump, toStamp, absentTickers }` |
| `DetectionOptions` | New interface: `{ threshold, guardPercent, guardFloor, prevCatalogSize }` |

All call sites updated. Existing tests that construct inline `InstrumentCatalogProvider` mock objects via `as never` casts were audited — all 8 cast sites enumerate both flags explicitly (verified in iter 9 Code Reviewer audit).

---

## 9. Convergence Iteration Log (9 iterations)

| Iter | Root cause | Fix |
|---|---|---|
| 1 | Phase 3 CR found C1 (`GET /admin/instruments` + `listAdminInstruments()` missing), H1 (6 POM testid drifts), H2 (admin cookie discarded in E2E), L1 (semantic gap — deferred), L2 (`routeError` in persistence paranoia guards) | Backend implementer: GET route + persistence method. QA: POM alignment + cookie install. |
| 2 | E2E smoke fail: AU instrument seed must happen BEFORE navigation (component fetches on mount). Pattern: `seedAsBrowser` → `navigateToRoute` per `e2e-oauth-seed-as-browser.md`. | QA: seed-before-nav order fix. |
| 3 | `/__e2e/seed-instruments` request carried the wrong session cookie — used test-scoped `request` jar instead of fresh context. | QA: isolate seed call in `withFreshContext` + install admin cookie header. |
| 4 | `memory.ts` `_replaceInstruments` wrote to `_instruments` store only, not mirroring to `_adminInstrumentMemRows`. `GET /admin/instruments` returned empty. | Backend implementer: mirror writes into both stores in `_replaceInstruments`. |
| 5 | Suite 6 flake: `tooltips-a11y-aaa.spec.ts:30` (`tooltipAccountContentIsVisible`) timed out. Pre-existing hover/focus animation race — verified: predates KZO-195, zero diff overlap, timeout class. User authorized iter 6 fix attempt. | — |
| 6 | `tooltips-a11y` race fix landed. Validator then hit transient Suite 5 ECONNRESET (infrastructure-class, not code regression). User authorized targeted rerun (suites 5–8 only). | Tooltip hover-wait fix in spec. |
| 7 | Targeted rerun (suites 5–8) surfaced 2 real KZO-195 bugs: (a) `admin-instruments` page empty after Suite 7 admin E2E setup; (b) Suite 8 cases 3+4 expecting `forbidden` error code instead of canonical `admin_role_required`. | — |
| 8 | (a) `memory.ts _seedInstrument` had a userId-null gate that skipped writing to `_adminInstrumentMemRows` for system-seeded rows. (b) HTTP spec asserting `body.error === "forbidden"` but route uses `admin_role_required`. | Backend implementer: remove userId-null gate. QA: align error code. |
| 9 | **Architectural pivot (Codex review):** P1 — binary `supportsDelistingFeed` gate routed US provider into absence-detection path (violates scope-todo: US out of scope). P2 — notification text claimed "absence-detected" for TW feed delistings (wrong discriminator). | Backend implementer: introduce `absenceDetectionEnabled` flag; replace marketCode gate with 3-way provider-flag gate in `runCatalogSync`. Notification text branched on `result.absentTickers.length > 0`. Code Reviewer re-audited all 8 `as never`-cast sites. |

---

## 10. Known Open Items

**L1 — `absent` counter semantic gap (acknowledged, not a code bug):**

`CatalogSyncResult.absent` counts all catalog-absent instruments including `delisting_detection_excluded=TRUE` rows. `absentTickers` and the guard-trip calculation use only candidates (excluded rows filtered). This means operator logs show a higher `absent` than the processed ticker count. Documented in the runbook (§23) and in the admin instruments page's threshold panel. No code change warranted — the metric is internally consistent and the gap is a feature (operators can see the full scope of absence even for excluded tickers).

**US enablement — deferred:**

`FinMindUsStockMarketDataProvider.absenceDetectionEnabled = false` is intentional. US out-of-scope per locked decision R1. Flip-on path documented in §1 above.

---

## 11. References

- Linear: <https://linear.app/kzokv/issue/KZO-195>
- Parent ticket: KZO-194 (TD AU catalog — `docs/004-notes/kzo-194/transition-202605071600-twelve-data-catalog.md`)
- Scope-todo: `docs/004-notes/kzo-195/scope-todo-202605090918-locked.md`
- Phase 3 Code Review: `docs/004-notes/kzo-195/review-202605091008-phase3.md`
- Runbook §23: `docs/002-operations/runbook.md` — Mass-delisting guard tripped
- Architecture: `docs/001-architecture/backend-db-api.md` — Delisting detection section
- Ticker hygiene rule: `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` — `AUDEL*` reservation
