# Refactor: Rename Caller Verification

When renaming exported functions across packages, grep all callers repo-wide before marking implementation complete. In-scope file lists from design docs may miss callers in other packages.

**The problem:**
Design docs list affected files, but cross-package callers are easy to miss. For example: renaming a function in `libs/config` affects `apps/api/src/server.ts`, but the implementer's file list only covered `libs/config`.

**Verification process:**
```bash
# Before marking the rename complete:
grep -r "oldFunctionName" --include="*.ts" --include="*.tsx" .

# Document all callers found:
# - libs/config/ (renaming here)
# - apps/api/src/server.ts (caller)
# - apps/web/lib/... (caller)
```

**In design docs:**
Add a "Callers of X" subsection listing all files that import/call the renamed function. Example:

```markdown
### Changes to validatePortConflicts → validateEnvConstraints

**Callers (must update):**
- apps/api/src/server.ts:42 — imports and calls
- libs/config/src/env.test.ts:88 — test file
```

**During implementation:**
1. Rename the function in the source package
2. Run grep to find all callers
3. Update all callers before closing the task
4. Code Reviewer verifies grep results in review

**Why:** Discovered in KZO-101/102 when Code Reviewer caught a missed caller in `apps/api/src/server.ts` that would have caused a runtime crash at server startup.

**How to apply:**
- When renames are part of a design, explicitly list all known callers in the design doc
- During implementation, grep before considering the refactor complete
- Code Reviewer should independently grep and verify during review
