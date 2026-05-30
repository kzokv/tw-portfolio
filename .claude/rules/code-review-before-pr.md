# Code Review Before PR Creation

Run a structured code review as a formal phase before PR creation — not deferred to PR review.

Structured pre-PR review catches architectural drift, pattern violations, and cross-file consistency issues that are invisible in diff view. PR-time review only catches formatting and obvious bugs.

**Workflow step:** After completing a significant implementation phase, run `/code-reviewer` to produce a structured review doc at `docs/004-notes/{area}/review-{datetime}-{slug}.md`. Work through the fix list top-down with TDD validation before creating the PR.

**Why:** Phase 5d CR produced 23 items across 5 severity tiers (Critical, High, Medium, Low, Informational). It caught fixture duplication, app-specific logic in generic framework, and type-safety gaps that would have been harder to fix after merge. Reinforced in KZO-144 where Codex review found 4 P1 issues (hard-purge cascade ordering, TOCTOU race) after the team's own validation passed.

**How to apply:** Any time a ticket involves 5+ files or crosses 2+ layers. This is step 6 in the ticket-to-PR workflow.

## Before claiming "typecheck green"

`tsc --noEmit -p <config>` only checks files reached by that config's `include` + any transitive imports. If a changed file is **not** transitively imported from an entry point inside `include`, type errors in it are silently skipped. Before claiming typecheck green:

1. Identify the tsconfig that covers each changed file (cross-reference against `include` / `rootDir`).
2. If any changed file is outside every tsconfig chained into `npm run typecheck`, either add it to an existing config's `include` or create a dedicated tsconfig and chain it in.
3. Re-run `npm run typecheck` and confirm it exits 0 with the new scope.

This is cheap (one grep) and closes the "false-green" class of failure where a project-ref gap masks real type errors. The canonical example: `apps/api/tsconfig.json` uses `rootDir: src`, so every file under `apps/api/test/**` is invisible to the main typecheck — `apps/api/test/tsconfig.json` is a separate config chained in for HTTP specs (see `full-test-suite.md`).

**Why:** Caught during KZO-145 pre-PR review — a discriminated-union access bug in `sharing-grant-dedup-existing-admin-invite-aaa.http.spec.ts` passed `npm run typecheck` because the spec wasn't in any config's include. Five sibling specs had the same bug silently. The rule converts "did I check scope?" from a judgment call into a checklist step.

### Type-augmentation `.d.ts` files must be explicitly included alongside new test files

Adding a new test file to `apps/api/test/tsconfig.json`'s `include` (or any sibling test config) can cause Fastify type-augmentation files (`apps/api/src/types/fastify.d.ts`) to silently drop out of the TS program. The new test's import graph may not transitively pull in the augmentation, so `FastifyInstance` reverts to its un-augmented shape — producing a 414-error cascade like `Property 'persistence' does not exist on type 'FastifyInstance'` across files that were previously green.

Fix: add the augmentation file to the test tsconfig's `include` explicitly:

```jsonc
{
  "extends": "../tsconfig.json",
  "include": [
    "http/**",
    "unit/**",
    "integration/**",
    "../src/types/fastify.d.ts"   // ← required; not transitively pulled by every test
  ]
}
```

**Symptom:** `npm run typecheck` was green before adding a new test file; after adding it, hundreds of unrelated `FastifyInstance` property errors appear in tests/files you didn't touch. The new file is "innocent" — it just has a different transitive import shape that the augmentation no longer rides along.

**Why:** Caught in KZO-196 (Backend) when adding `apps/api/test/integration/asxGicsCatalogSync.integration.test.ts` to the test tsconfig's `include`. The new test's import chain (`PostgresPersistence` + `asxGicsSyncWorker` → `app.js`) didn't carry `fastify.d.ts` along the way, dropping the augmentation from the program.

**How to apply:** Whenever a new test directory or a new test file is added to a test tsconfig's `include`, also confirm the augmentation file (`src/types/fastify.d.ts` for the API, or equivalent for other apps) is in `include`. This is a pre-PR Code-Reviewer checklist item for any diff that touches an `apps/*/test/tsconfig.json`.
