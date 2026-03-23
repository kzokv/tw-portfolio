---
date: 2026-03-21
branch: kzo-101
task: KZO-101 + KZO-102 doc update
---

## KZO-101/102 Documentation Update — Findings

### Files Updated

**`docs/004-notes/003-oauth-env-refactor/005b-kzo-101-102-implementation-todo.md`**
- Added `Status: COMPLETE` header note
- Marked all `[ ]` checklist items as `[x]`

**`docs/004-notes/003-oauth-env-refactor/001-env-variable-refactor-plan.md`**
- Section 2.3: Updated schema consolidation table — `webEnvSchema` row corrected from "Removed / Folded into envSchema" to "Derived via `pick().extend()`" with reference to doc 05 decision #1
- Section 3: All three `validatePortConflicts()` references → `validateEnvConstraints()`. Added `validateCookieDomainRequired()` row.
- Section 3: dev_bypass restriction description updated from allowlist logic (`NODE_ENV=development`) to denylist (`NODE_ENV=production`)
- Section 4.1 flowchart: `validatePortConflicts` → `validateEnvConstraints`, dev_bypass check node updated
- Section 4.8 dependency graph: Removed stale `AUTH_USER_ID` node (removed in KZO-99)

### No Changes Needed

- `libs/config/package.json` exports — already has `./schema`, `./docker`, `./web`, `./metadata` entries, all correct
- Inline code comments — no stale function names found in `libs/` or `apps/`
- Docs 02, 03 — historical review documents; stale `dockerDevSchema`/`validatePortConflicts` references are in design narrative context, not prescriptive specs
- Memory files in `.claude/memory/` — stale refs exist but out of scope for this doc pass

---
