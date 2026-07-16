# Holdings And Posted Transaction Mutation Validation

Date: 2026-07-16

Scope:

- `scope-todo-202607161055-posted-transaction-mcp.md`
- Required prior scope `scope-todo-202607160920-holdings-requests-bugs.md`
- Mockups under `docs/notes/holdings-requests-bugs/mockups/`

## Final Repository Gates

Evidence:

| Gate | Command | Outcome |
| --- | --- | --- |
| Lint | `npx eslint .` | Passed with 0 errors; 37 existing Playwright conditional warnings. |
| TypeScript | `npm run typecheck` | Passed. |
| Web unit | `npm run test --prefix apps/web` | Passed both configured Vitest populations. |
| API package | `npm run test --prefix apps/api` | 201 files passed, 49 skipped; 2,083 tests passed, 473 skipped. |
| Managed Postgres | `npm run test:integration:full:host` | 103 files passed; 1,045 tests passed, 1 skipped. |
| Dev-bypass E2E | `npm run test:e2e:bypass:mem --prefix apps/web` | 398 passed, 19 skipped across desktop, mobile, and tablet projects. |
| OAuth E2E | `npm run test:e2e:oauth:mem --prefix apps/web` | 121 passed. |
| API HTTP | `npm run test:http --prefix apps/api` | 308 passed, 2 skipped. |

Additional checks:

- Production Next.js builds completed in both full web E2E commands.
- `git diff --check` passed.
- Final base check reported `0 0` for `HEAD...origin/dev` before publication.
- Holdings selection, fee discount persistence, posted transaction mutation, dividend stock presentation, and mutation admin policy have focused unit/integration/E2E coverage.

## Validation Issues And Resolutions

1. Account revision reads could pair a newer revision with an older hydrated accounting store. Preview now brackets hydration with revision reads and rejects drift; simulation rechecks revisions before persistence.
2. Concurrent identical Postgres confirmations could report stale state to the losing caller. Confirmation now returns the already-created run when preview ID and digest match, preserving idempotency.
3. Mutation rebuild status could diverge between replay scopes and the linked mutation run. Synchronous and worker paths now persist running and terminal status, scope failures, and lifecycle events.
4. Rebuild recovery attempted each scope only once. Mutation-linked scopes now retry up to three bounded attempts and exhausted runs direct the caller to the existing preview/replay recovery tools.
5. In global holdings `all` mode, clicking an inline ticker entered custom mode by excluding the clicked ticker. It now enters custom mode with the clicked ticker selected; unit and E2E assertions cover the transition and persistence.
6. Fee profile discount persistence lacked end-to-end coverage. The settings assistant and browser scenario now edit, leave, reopen, and verify the saved discount.
7. One OAuth full-suite attempt dropped the dashboard card over itself and timed out waiting for a preference PATCH. The trace showed no application request because the pointer drag did not move. The same case passed three consecutive focused repetitions, and the exact full OAuth suite then passed 121/121; no product defect was found.

## Review Outcome

The final diff was checked against both locked scope documents. All product steps have implementation and test evidence, no out-of-scope bulk web authoring was added, and no compatibility path retains persist-before-replay transaction mutation behavior.

## Codex Review Follow-up

Codex review on PR #290 identified two actionable route-level issues:

1. The new mutation preview and confirmation routes were present in the delegated capability matrix but absent from `SHARED_CONTEXT_WRITE_ROUTE_KEYS`. All three routes now enter the shared-context capability guard, and a table-driven integration test proves viewers without `transaction:write` receive `shared_capability_required` before route handling.
2. The legacy transaction impact response derived `negativeLots.wouldOccur` only from final open quantity. It now treats canonical replay blockers as authoritative, so an intermediate negative position is reported even when a later buy restores the final quantity to zero.

Follow-up evidence:

- `npx vitest run test/integration/shared-context-delegated-capabilities.integration.test.ts test/integration/transaction-mutations.integration.test.ts`: 56 passed.
- `npx eslint apps/api/src/routes/registerRoutes.ts apps/api/test/integration/shared-context-delegated-capabilities.integration.test.ts apps/api/test/integration/transaction-mutations.integration.test.ts`: passed.
- `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/api/test/integration/tsconfig.json`: passed.
- `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,085 tests passed, 473 skipped.

## Waiver

No Linear ticket was provided. The user-approved publication path is:

- Label: `waiver:linear-ticket`
- Approved-by: `@kzokv`
- Scope: `both`
