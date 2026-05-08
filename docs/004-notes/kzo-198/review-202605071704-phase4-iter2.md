# KZO-198 Phase 4 Code Review — Iter 2 (Delta)

**Reviewer:** Code Reviewer (Sonnet)
**Date:** 2026-05-07T17:04
**Branch:** `worktree-kzo-198`
**Iteration:** 2 (delta only — M1, M2, M3 fixes from iter-1)
**Design authority:** `.worklog/team/design.md`

---

## Scope

Delta review of three iter-1 findings: M1 (AdminSettingsClient hardcoded bounds), M2 (MaskedSecretInput hardcoded bounds), M3 (migration COMMENT tier labels). H1, L1, L2, I1–I3 are out of scope per Architect brief.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Informational | 1 |

**No blocking findings.** All three iter-1 Medium findings are resolved. Ready for Validator gate.

---

## H1 Disposition Note (Architect-directed)

Per Architect's iter-2 brief: H1 (Tier 2 fields in `patchAdminSettingsSchema`) was a stale-snapshot artifact. At HEAD, `TIER1_PLAIN_FIELDS` contained exactly 12 entries and `patchAdminSettingsSchema` used `.strict()` to reject Tier 2 keys before iter-1 was generated. H1 is **closed — was not a regression in the reviewed code**.

---

## CRITICAL

_None._

---

## HIGH

_None. H1 dispositioned above._

---

## MEDIUM

### M1 — RESOLVED ✓

**File:** `apps/web/components/admin/AdminSettingsClient.tsx`

**Fix verified:**
- `MIN_MINUTES` and `MAX_MINUTES` module-level constants are **gone** (grep confirms zero matches).
- `repairCooldownMinutes` form section now uses `NumericOverrideRow` with `bounds={config.bounds.repairCooldownMinutes}` (line 246) — identical pattern to all KZO-198 Tier 1 fields.
- File-level comment (lines 1–6) explicitly documents the intent: "The `NumericOverrideRow` component reads `min`/`max` from `config.bounds` directly; no module-level constants are duplicated in this file."
- No stale validation function using hardcoded values remains.

---

### M2 — RESOLVED ✓

**Files:** `apps/web/components/admin/MaskedSecretInput.tsx`, `apps/web/components/admin/AdminSettingsClient.tsx`

**Fix verified:**
- `MIN_SECRET_LENGTH` and `MAX_SECRET_LENGTH` module-level constants are **gone** (grep confirms zero matches).
- `MaskedSecretInputProps` now includes `secretLengthBounds?: { min: number; max: number }` (line 45).
- Default `DEFAULT_SECRET_LENGTH_BOUNDS = { min: 20, max: 500 } as const` defined at module level (line 23); applied in function destructuring: `secretLengthBounds = DEFAULT_SECRET_LENGTH_BOUNDS` (line 188). Backward-compatible ✓.
- `RotateModal` sub-component receives `bounds={secretLengthBounds}` (line 278) and uses `bounds.min`/`bounds.max` throughout: length error logic (lines 78–83), `canSubmit` gate (line 83), `placeholder` text (line 128), counter display (line 133).
- `AdminSettingsClient` passes `secretLengthBounds={config.secretLengthBounds}` at **both** `MaskedSecretInput` call sites (lines 638 and 647). ✓

---

### M3 — RESOLVED ✓

**File:** `db/migrations/047_kzo198_app_config_tier_a_constants.sql`

**Fix verified** — all 6 `COMMENT ON COLUMN` tier labels per iter-1 table:

| Column | Was (iter-1) | Now | Expected |
|---|---|---|---|
| `provider_error_trail_retention_days` | Tier 2 | **Tier 1** (line 68–69) | Tier 1 ✓ |
| `backfill_retry_limit` | Tier 2 | **Tier 1** (line 73–74) | Tier 1 ✓ |
| `backfill_retry_delay_seconds` | Tier 2 | **Tier 1** (line 75–76) | Tier 1 ✓ |
| `daily_refresh_lookback_days` | Tier 1 | **Tier 2** (line 79–80) | Tier 2 ✓ |
| `sse_heartbeat_interval_ms` | Tier 1 | **Tier 2** (line 84–85) | Tier 2 ✓ |
| `sse_max_connections_per_user` | Tier 1 | **Tier 2** (line 86–87) | Tier 2 ✓ |

Migration remains in-place edit (pre-merge, not yet applied) — consistent with `migration-strategy.md` ✓.

---

## INFORMATIONAL

### I4 — `sse_buffer_default_ttl_ms` COMMENT has no tier label (pre-existing, acceptable)

**File:** `db/migrations/047_kzo198_app_config_tier_a_constants.sql:88–89`

`sse_buffer_default_ttl_ms` COMMENT reads: `'Tier 2 — BufferedEventBus per-user buffer TTL (ms). NULL = use env default.'` — actually, checking line 88–89, the label correctly says "Tier 2". This is consistent with it being a DB-only escape hatch field (no UI form, absent from PATCH schema per `.strict()`). **No action needed.**

---

## Checklist (iter-2 scope)

| Item | Result |
|---|---|
| `MIN_MINUTES`/`MAX_MINUTES` removed from AdminSettingsClient | ✓ |
| `repairCooldownMinutes` uses `NumericOverrideRow` + `config.bounds.repairCooldownMinutes` | ✓ |
| `secretLengthBounds` prop on `MaskedSecretInputProps` (optional, with default) | ✓ |
| Backward-compatible default `{ min: 20, max: 500 }` applied in destructuring | ✓ |
| Both `MaskedSecretInput` call sites pass `config.secretLengthBounds` | ✓ |
| `RotateModal` uses `bounds.min`/`bounds.max` exclusively (no hardcoded constants) | ✓ |
| All 6 migration COMMENT tier labels corrected | ✓ |
| Migration still pre-merge (in-place edit valid) | ✓ |
| H1 disposition documented | ✓ |
