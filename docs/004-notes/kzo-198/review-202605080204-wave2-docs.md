# KZO-198 Wave 2 Docs Compliance Review

**Reviewer:** Code Reviewer (Sonnet)
**Date:** 2026-05-08T02:04
**Branch:** `worktree-kzo-198`
**Iteration:** Wave 2 (pre-shutdown gate)
**Design authority:** `.worklog/team/design.md`

---

## Scope

Structural + accuracy review of 5 Wave 2 deliverables:
1. `docs/004-notes/kzo-198/transition-202605081200-tier-a-app-config.md`
2. `.worklog/team/pr-description-draft.md`
3. `.env.example` (KZO-198 section)
4. `docs/002-operations/runbook.md §22`
5. `docs/001-architecture/app-config.md`

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |
| Informational | 2 |

**One MEDIUM finding (M1) in the architecture doc footnote — wrong DB column name.** Pre-merge correction. All PR structural gate checks pass. No CI-blocking findings.

---

## CRITICAL

_None._

---

## HIGH

_None._

---

## MEDIUM

### M1 — `app-config.md` §7 Tier 1 footnote cites wrong DB column name

**File:** `docs/001-architecture/app-config.md:207`

**What was found:**

```
_(1 Tier 1 search rate-limit column reads the existing
`Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE` as fallback —
column name `market_data_search_rate_limit_per_minute`.)_
```

The **env var name** (`MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE`) is correct. But the **DB column name** is wrong. The actual column added by migration 047 (line 27) is:

```sql
ADD COLUMN IF NOT EXISTS market_data_search_limit  INT NULL,
```

Confirmed also by `rateLimits.ts`:
```ts
return getAppConfigCacheEntry()?.marketDataSearchLimit ?? Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE;
```

Any operator querying the column (e.g. via the Tier 2 SQL escape hatch pattern or the audit query template) and using `market_data_search_rate_limit_per_minute` will get a "column not found" error at runtime.

**Fix:**

```markdown
_(1 Tier 1 search rate-limit column reads the existing
`Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE` as fallback —
column name `market_data_search_limit`.)_
```

---

## LOW

_None._

---

## INFORMATIONAL

### I1 — PR description `## Solution` cites `openssl rand -hex 32` without mentioning env-setup

**File:** `.worklog/team/pr-description-draft.md:23`

```
Generate with `openssl rand -hex 32`.
```

The Runbook §22 correctly documents `npm run env:setup` as the primary path and `openssl rand -hex 32` as the manual/CI fallback. The PR description references only the raw `openssl` command, which is technically accurate but omits the primary operator path. This is not a CI gate issue — the Runbook is the authoritative operational reference. No action required; the Runbook is correct.

---

### I2 — Architecture doc §7 Tier 1 table has 11 rows; 12th documented in footnote

**File:** `docs/001-architecture/app-config.md:192–207`

The Tier 1 table has 11 explicit rows. The 12th Tier 1 column (`market_data_search_limit`) is covered by a footnote. This structure is acceptable — the 19-column total is consistent across migration, transition note, and both docs. No action required beyond the M1 fix (which corrects the footnote's column name).

---

## PR structural gate checks (ci-blocking if missed)

| Check | Result |
|---|---|
| `## Problem` — separate section, describes the gap | ✓ (lines 11–13) |
| `## Solution` — separate section, lists structural change | ✓ (lines 15–24) |
| `## Testing` — present with `Evidence:` block, all 8 suites, concrete counts | ✓ (lines 26–57) |
| `## Risk/Rollback` — what could go wrong, revert procedure | ✓ (lines 59–75) |
| Behavioral deltas under `### Behavioral deltas (intentional, not regressions)` heading | ✓ (3 deltas: `.strict()` 400s, 8s TTL stale window, decrypt-failure env fallback) |
| Tooltip flake explicitly called out with 5-point ruling | ✓ (lines 50–57, all 5 criteria documented) |
| Renamed types/classes table | ✓ vacuous — KZO-198 introduces only new types/classes (no renames); transition note §3 has the formal table; PR body describes them inline in `## Solution` |

---

## Deliverable accuracy checks

### 1. Transition note (`transition-202605081200-tier-a-app-config.md`)

| Check | Result |
|---|---|
| §1.1 resolver call-site table complete (15 rows) | ✓ |
| §1.2 Tier 2 rejection table with 5 fields | ✓ |
| §1.3 audit discriminator table (value_change / rotation / absent) | ✓ |
| §1.4 pre-warm hook reordering documented | ✓ |
| §1.5 `APP_CONFIG_ENCRYPTION_KEY` property table | ✓ |
| §1.6 migration 047 column count = 19 (2+12+5) | ✓ |
| §2 new env vars table — cron vars documented as live-wired | ✓ (line 146) |
| §3 renamed/new types and classes table | ✓ (5 symbols, all new) |
| §4 deferred tests — honest about coverage gaps, non-defensive | ✓ |
| §5 rollback plan — 3 steps, no circular dependency | ✓ |

### 2. `.env.example`

| Check | Result |
|---|---|
| `grep -nE '^[^#].*=.*[ \t]'` — unquoted active values with spaces | ✓ 0 matches |
| CRON values double-quoted in commented defaults | ✓ `"30 17 * * 1-5"`, `"0 22 * * *"`, `"0 4 * * *"` |
| `APP_CONFIG_ENCRYPTION_KEY` env-setup described as auto-generated path; openssl as manual fallback | ✓ (lines 117–118) |
| Tier 1 / Tier 2 / Tier 3 cron sections present with inline descriptions | ✓ |

### 3. Runbook §22

| Check | Result |
|---|---|
| env-setup as **primary path** | ✓ (lines 1780–1786, "recommended path") |
| `openssl rand -hex 32` as **manual/CI fallback** | ✓ (lines 1788–1794, "Manual fallback (CI / headless environments)") |
| Cron vars described as "fully wired to their respective workers" | ✓ (line 1913) |
| No stale "future candidate" prose | ✓ (grep returns 0 matches) |
| Migration 047: 19 nullable columns, no CHECK constraints | ✓ (lines 1807–1813) |
| Tier 2 SQL escape hatch examples | ✓ (5 SQL examples, lines 1856–1872) |
| Decryption-failure troubleshooting + reason code table | ✓ |
| Key rotation warning + out-of-scope disclaimer | ✓ |
| Quoting requirement callout box | ✓ (line 1923) |

### 4. Architecture doc (`docs/001-architecture/app-config.md`)

| Check | Result |
|---|---|
| KZO-121 cross-instance pub/sub follow-up in §3 | ✓ (full section with Redis vs Postgres LISTEN options) |
| Cache behaviour contract table (5 conditions) | ✓ |
| Per-category resolver table (7 modules + bounds.ts) | ✓ |
| Encryption module documented (algorithm, typed error, log safety) | ✓ |
| Tiering summary table (4 tiers) | ✓ |
| §7 column inventory — total count matches migration 047 (19) | ✓ (11+1fn Tier 1 + 2 Tier 0 + 5 Tier 2 = 19) |
| §7 Tier 1 footnote column name accurate | ✗ **M1 above** |
