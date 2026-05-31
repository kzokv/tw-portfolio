---
slug: kzo-189
type: review
created: 2026-05-06T02:07:00Z
reviewer: code-reviewer
iteration: wave2-docs
verdict: CLEAN
---

# Code Review — KZO-189 Wave 2 Docs (Structural Compliance Pass)

**Verdict: CLEAN** — 0 Critical · 0 High · 0 Medium · 2 Low · 0 Informational

No blocking findings. PR creation unblocked. Low findings are non-blocking nits; routing to Tech Writer at their discretion.

---

## File 1 — Transition Note (`transition-202605061930-metadata-enrichment-gate.md`)

### Section headings — PASS

All four `pr-gate.yml`-required headings present in order:

| Heading | Present | Line |
|---|---|---|
| `## Problem` | ✓ | 3 |
| `## Solution` | ✓ | 9 |
| `## Testing` | ✓ | 53 |
| `## Risk/Rollback` | ✓ | 67 |

### Evidence block — PASS

`Evidence:` keyword present. All 8 suite counts match the architect's `state.json.exit_check.ruling` values:

| Suite | Expected | File 1 |
|---|---|---|
| 1 (lint) | 0 errors | 0 errors ✓ |
| 2 (typecheck) | 0 errors | 0 errors ✓ |
| 3 (web unit) | 352 passed | 352 passed ✓ |
| 4 (api unit + memory integration) | 943 passed, 313 skipped | 943 passed, 313 skipped ✓ |
| 5 (postgres integration) | 600 passed, 1 skipped | 600 passed, 1 skipped ✓ |
| 6 (E2E bypass) | 196 passed | 196 passed ✓ |
| 7 (E2E oauth) | 90 passed | 90 passed ✓ |
| 8 (api HTTP) | 207 passed, 2 skipped | 207 passed, 2 skipped ✓ |

Note: File 1 uses markdown list bullets (`- Suite N ...`). See LOW-1 for File 1 vs File 4 formatting delta.

### Truth table — PASS

3-row truth table present verbatim at lines 26–30:

| `mode` | `trigger` | `shouldEnrich` | `reserveCapacity` |
|---|---|---|---|
| `unconditional` | any | `true` | 3 |
| `conditional` | `user_selection`/`first_trade`/`retry`/`repair` | `true` | 3 |
| `conditional` | `daily_refresh` | **`false`** | **`2`** |

Matches the 3-row specification (unconditional×any, conditional×ALLOW-list, conditional×daily_refresh). ✓

### Audit signal — PASS

Present at lines 45–51:
- `app_config_updated` action ✓
- `metadata.before.metadataEnrichmentMode` and `metadata.after.metadataEnrichmentMode` ✓
- Filter URL `GET /admin/audit-log?action=app_config_updated` ✓

### KZO-190 escalation path — PASS

Present at line 75:
> "the correct escalation is to revisit the `reserveCapacity` math in KZO-190. KZO-189 only addresses the daily_refresh over-consumption; per-trigger budget optimization is a separate concern."

Correctly names KZO-190, not KZO-189, as the escalation target. ✓

---

## File 2 — KZO-172 Transition Note §8 Correction

### Old text removed — PASS

```
grep -c "feature-flag approach" → 0  ✓
grep -c "avoids touching the worker's core logic" → 0  ✓
```

Both OLD text strings are absent from the file.

### New text present — PASS

```
grep -A2 "Updated: KZO-189" → match found:
```

Confirmed verbatim match against the architect's required replacement:

> **(Updated: KZO-189)** The metadata enrichment gate was implemented in KZO-189 and does touch `backfillWorker.ts` core logic: the `shouldEnrich` predicate, `reserveCapacity(2 + (shouldEnrich ? 1 : 0))` formula, and `if (shouldEnrich) { ... }` wrapper around the enrichment block. See `docs/004-notes/kzo-189/transition-202605061930-metadata-enrichment-gate.md` for full implementation details.

Replacement is in-place (not supplemental). ✓

---

## File 3 — Runbook §20

### Five acceptance items — PASS (with LOW-2)

| Item | Coverage | Status |
|---|---|---|
| Where setting lives | "`/admin/settings` → 'Metadata Enrichment Mode' select, or `METADATA_ENRICHMENT_MODE` env var" + "Default: `conditional`" | ✓ |
| When to flip | "Frequent `backfill_rate_limited` warnings in logs... may indicate enrichment is running more often than needed. Confirm `mode = conditional` is set." | ✓ (see LOW-2) |
| How to flip | Admin UI dropdown + `METADATA_ENRICHMENT_MODE=unconditional` env var | ✓ |
| How to audit | "`action = 'app_config_updated'`... `metadata.before.metadataEnrichmentMode` and `metadata.after.metadataEnrichmentMode`" | ✓ |
| Rollback lever | "`METADATA_ENRICHMENT_MODE=unconditional`... restore pre-KZO-189 behavior" | ✓ |

### Stale-reference grep — PASS

```
grep -niE "future candidate|follow-up|not in this release|future cron|metadata enrichment" runbook.md
```

Result: 3 matches, all inside §20 (lines 1607, 1613, 1615). No stale forward-note references outside §20. ✓

---

## File 4 — PR Description Draft

### Section headings — PASS

All four `pr-gate.yml`-required headings present:

| Heading | Present | Line |
|---|---|---|
| `## Problem` | ✓ | 14 |
| `## Solution` | ✓ | 19 |
| `## Testing` | ✓ | 56 |
| `## Risk/Rollback` | ✓ | 70 |

(`## Summary` also present at line 11 — not required, no issue.)

### Title — PASS

Line 5:
```
feat(api,web,db): KZO-189: gate AU metadata enrichment on trigger; admin-configurable mode
```
Matches expected title exactly. ✓

### Evidence block — PASS

All 8 suite counts match File 1 values exactly (see LOW-1 for formatting delta). ✓

### Cross-references — PASS

All three required references present:
- Linear ticket URL: `[KZO-189](https://linear.app/kzokvdevs/issue/KZO-189)` in `## Problem` ✓
- Transition note: `docs/004-notes/kzo-189/transition-202605061930-metadata-enrichment-gate.md` ✓
- KZO-172 §8 reference: `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md` ✓

### Behavioral deltas — PASS

Present at lines 44–47 under `**Behavioral deltas (intentional, not regressions):**`:
- Default `conditional` mode skips `fetchInstrumentMetadata` on `daily_refresh` ✓
- `usStockBackfill.integration.test.ts` switched to `"unconditional"` — labeled "correct test-setup call, not a behavioral regression" ✓
- Runtime rollback via `unconditional` mode, no replay needed ✓

### Renamed types/classes — PASS

Line 49: `**Renamed types/classes:** N/A — no renames, only additions.` ✓

Correct — KZO-189 introduces no renames, only additions (`AppConfigDto` field additions, new `metadataEnrichmentMode.ts` service, new migration column). N/A is the correct entry.

---

## LOW Findings

### LOW-1 — Evidence block format inconsistency between File 1 and File 4

**File 1** uses markdown list bullets:
```
Evidence:
- Suite 1 (lint): 0 errors
- Suite 2 (typecheck): 0 errors
...
```

**File 4** uses indentation:
```
Evidence:
  Suite 1 (lint): 0 errors
  Suite 2 (typecheck): 0 errors
...
```

The architect's MEDIUM bar is "Evidence block counts don't match between File 1 and File 4." — **counts are identical**, so severity is below MEDIUM. The formatting difference is cosmetic and does not affect CI gate behavior or readability. Routing as LOW at Tech Writer's discretion for a one-line alignment fix.

### LOW-2 — Runbook §20 "When to flip" omits `daily_refresh` window context

The acceptance item specifies: "symptom: frequent `backfill_rate_limited` warnings **during daily_refresh windows**."

The runbook covers the `backfill_rate_limited` signal and the "mode too aggressive" diagnostic, but does not specify "during daily_refresh windows" as the temporal qualifier. Without this context, an operator seeing `backfill_rate_limited` on a user-triggered backfill (expected when the shared budget is genuinely exhausted) might incorrectly diagnose it as a mode issue.

Suggested addition to §20 "When to change":
> Keep `conditional` (default) under normal operation to preserve Yahoo Finance API budget — daily refreshes only update price bars, not instrument metadata. If `backfill_rate_limited` warnings appear specifically during the **daily refresh window** (not on user-triggered backfills), confirm `METADATA_ENRICHMENT_MODE=conditional` is set; `unconditional` mode would cause daily_refresh jobs to consume the extra quote() slot unnecessarily.

No action required before PR merge — this is operational guidance, not a CI-blocking gap.

---

## Summary Table

| File | Verdict | Blocker? |
|---|---|---|
| File 1 — Transition note | PASS | No |
| File 2 — KZO-172 §8 correction | PASS | No |
| File 3 — Runbook §20 | PASS | No |
| File 4 — PR description draft | PASS | No |

**PR creation is unblocked.** `pr-gate.yml` will accept the PR description as-is.
