---
name: rename-caller-grep
description: When renaming exported functions, grep all callers across the entire repo before marking implementation complete
type: feedback
---

When renaming an exported function (e.g. `validatePortConflicts` → `validateEnvConstraints`), always grep for all callers across the entire repo before marking implementation complete. The in-scope file list for a task may miss callers in other packages.

**Why:** In KZO-101/102, the design doc listed "Update all callers" but the TDD Implementer's in-scope file list omitted `apps/api/src/server.ts` (which called a function from `libs/config`). The Code Reviewer caught it as a HIGH finding — it would have caused a runtime crash at server startup.

**How to apply:** When writing design docs that include renames, explicitly grep for all callers and list them in the in-scope files section. Add a "callers of X" subsection to the design. When implementing a rename, run a grep before closing the task.
