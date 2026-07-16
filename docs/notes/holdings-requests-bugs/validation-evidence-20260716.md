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
5. In global holdings `all` mode, clicking an inline ticker initially entered custom mode with only that ticker selected. It now preserves the rest of the universe and excludes only the clicked ticker; focused hook coverage verifies the transition and persistence.
6. Fee profile discount persistence lacked end-to-end coverage. The settings assistant and browser scenario now edit, leave, reopen, and verify the saved discount.
7. One OAuth full-suite attempt dropped the dashboard card over itself and timed out waiting for a preference PATCH. The trace showed no application request because the pointer drag did not move. The same case passed three consecutive focused repetitions, and the exact full OAuth suite then passed 121/121; no product defect was found.
8. Current-head CI exposed a stale assertion in the new holdings selection persistence E2E: after deselecting `8811` from all mode, it expected `8811` to remain visible and `8812` to disappear. The assertion now matches the locked behavior and focused hook coverage: the deselected ticker is hidden while the remaining selected ticker stays visible. The exact production-build E2E command passed 1/1 locally.

## Review Outcome

The final diff was checked against both locked scope documents. All product steps have implementation and test evidence, no out-of-scope bulk web authoring was added, and no compatibility path retains persist-before-replay transaction mutation behavior.

## Codex Review Follow-up

Codex review on PR #290 identified actionable issues across sixteen review rounds:

1. The new mutation preview and confirmation routes were present in the delegated capability matrix but absent from `SHARED_CONTEXT_WRITE_ROUTE_KEYS`. All three routes now enter the shared-context capability guard, and a table-driven integration test proves viewers without `transaction:write` receive `shared_capability_required` before route handling.
2. The legacy transaction impact response derived `negativeLots.wouldOccur` only from final open quantity. It now treats canonical replay blockers as authoritative, so an intermediate negative position is reported even when a later buy restores the final quantity to zero.
3. Mutation impact quantity and cash deltas used unsigned display values. Item and summary impacts now use signed position effects and signed cash-ledger effects, including BUY cash outflows and SELL deletion reversals.
4. The legacy GET impact route called durable preview creation. It now uses the same canonical simulation through non-persisting wrappers; durable records remain exclusive to the guarded mutation-preview POST routes.
5. Shared update confirmations only checked `dividend:write` for delete operations. Both explicit confirmation and the legacy PATCH bridge now require `dividend:write` whenever preview impact deletes or reopens dividend state.
6. The legacy shared PATCH bridge attributed mutation previews, runs, replay runs, and atomic audit records to the portfolio owner. It now uses the authenticated session actor while retaining the owner as portfolio context.
7. The first dividend-authorization regression fixture exposed that superseded/reversed ledger rows were still counted as active preview impact. The active dividend summary now excludes those rows, and the corrected fixture proves an update that retires eligibility is blocked without `dividend:write`.
8. Holdings row selection controls appeared unchecked in the default all-tickers mode. In-universe tickers now report selected while unavailable ticker identities remain unchecked.
9. Leaving all-tickers mode from an inline row control retained only the clicked ticker. The custom selection now starts from the current universe and removes the clicked ticker, preserving every other holding.
10. The delete confirmation dialog labeled monetary and quantity deltas as cash-entry and lot-allocation row counts. Localized copy now presents formatted cash-balance and holdings-quantity changes explicitly.
11. The legacy DELETE alias accepted only the new mutation preview storage after the canonical mutation rollout, even though its adjacent legacy preview endpoint still issued dividend-destructive preview IDs. The alias now preserves both flows: canonical mutation previews use the new mutation path, while legacy preview IDs use the original dividend-destructive confirmation and response.
12. Shared dividend-impact update and delete previews could persist a durable preview before the route verified `dividend:write`. Batch previews and the legacy PATCH bridge now run a non-persisting canonical simulation first, reject unauthorized dividend impact, and create durable preview records only after authorization succeeds.
13. Shared mutation preview and run deep links omitted the portfolio owner, so opening a link outside the existing browser context could request the delegate's own portfolio. Generated paths and absolute URLs now include `?as=<owner>`, and both server-rendered pages validate and forward that owner context on their initial API fetch.
14. MCP update and delete preview tools could persist dividend-impacting previews for delegated connectors before checking `dividend:write`. Shared MCP previews now run the same non-persisting simulation first and require both connector scope and share capability before durable preview creation.
15. Delegated preview reloads relied on the context cookie being written before the client effect ran. The validated owner context is now passed through preview filtering/reloads and adjacent run polling as an explicit session-scoped API header.
16. Transaction edits with protected manual or source-provided fees bypassed the existing fee recalculation choice. Quantity, price, and side changes now pause before preview and let the user explicitly recalculate or preserve the recorded fee amounts.
17. Leaving holdings all-mode from a report-scoped table materialized only the visible report universe, which could silently drop holdings outside that view. The transition now fetches the full primary-portfolio holdings universe before persisting the custom selection.
18. Synchronous mutation rebuilds refreshed account and portfolio state but omitted the currency wallet snapshot refresh performed by the worker path. Successful synchronous rebuilds now run the same best-effort wallet snapshot regeneration.
19. Posted-mutation HTTP and MCP update schemas accepted fractional quantities and prices beyond database precision. Both boundaries now enforce positive integer quantities and positive prices in cent increments before a preview can be persisted.
20. Owner reads and confirmations of delegate-created mutation records were rejected by the delegated actor match. Owners may now inspect and confirm records on their own portfolio, while other delegates remain restricted to records they created.
21. The portfolio compact holdings view inherited the dashboard top-holdings preference context. It now explicitly uses the portfolio holdings context, keeping dashboard and portfolio column, limit, and layout settings isolated.
22. SELL-to-BUY mutation replay retained the original sell's realized P&L fields because replay only assigns those fields to sells. Side changes now clear derived realized P&L before replay, so previews and committed accounting reflect the corrected BUY.
23. Restrictive mutation actor foreign keys could block hard purge for owners or delegates with mutation history. The mutation schema now permits actor deletion without blocking the purge, with real-Postgres coverage for a delegated actor and a separate portfolio owner.
24. Postgres account rewrites cleared AI draft rows' confirmed trade links through the `ON DELETE SET NULL` foreign key, including links for trades immediately reinserted by the rewrite. Rewrites now capture and restore links for retained trades after reinsertion, while genuinely deleted trades resolve their durable mutation lineage by draft-row ID so deletion status remains visible without weakening referential integrity.
25. Cascading delegated actor references allowed a delegate purge to erase mutation history owned by another user. Append-only migration `108` makes preview/run actor and deleted-lineage deleter attribution nullable with `ON DELETE SET NULL`, while retaining cascade ownership from preview to run and lineage. The purge regression verifies the owner and all owner-owned mutation artifacts survive with anonymized attribution.
26. Delegated AI draft creators still cascaded owner-owned draft batches during purge, conflicting with retained mutation lineage. Append-only migration `109` makes draft creator attribution nullable with `ON DELETE SET NULL`; DTO and persistence records expose anonymized creators as `null`, and memory persistence mirrors owner cascade versus delegated-creator anonymization.
27. Deleted draft lineage used restrictive batch/row references that could block the simultaneous owner, batch, row, and lineage cascades during owner purge. Append-only migration `110` makes both lineage links cascade; the Postgres regression now purges the owner after the delegate and verifies the complete owner-owned chain is removed.
28. Memory hard purge anonymized delegated draft creators but left owner-owned draft event actor IDs intact. Memory persistence now nulls draft-event owner/actor attribution just as the Postgres event foreign keys do, with aggregate-read coverage after purge.

Follow-up evidence:

- `npx vitest run test/integration/shared-context-delegated-capabilities.integration.test.ts test/integration/transaction-mutations.integration.test.ts`: 56 passed.
- `npx eslint apps/api/src/routes/registerRoutes.ts apps/api/test/integration/shared-context-delegated-capabilities.integration.test.ts apps/api/test/integration/transaction-mutations.integration.test.ts`: passed.
- `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/api/test/integration/tsconfig.json`: passed.
- `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,085 tests passed, 473 skipped.
- Second-round focused mutation tests: 68 passed.
- Second-round API TypeScript and ESLint checks: passed.
- Second-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,087 tests passed, 473 skipped.
- Third-round focused mutation/shared-context tests: 69 passed.
- Third-round API TypeScript and ESLint checks: passed.
- Third-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,088 tests passed, 473 skipped.
- Fourth-round focused holdings-selection and delete-dialog tests: 3 passed. The first dialog assertion expected an ISO currency code, while the shared formatter correctly emitted `NT$`; the assertion was aligned with the existing formatter and reran cleanly.
- Fourth-round web TypeScript and changed-file ESLint checks: passed.
- Fourth-round `npm run test --prefix apps/web`: 85 component/app files with 580 tests passed, followed by 80 feature/lib files with 534 tests passed.
- Fifth-round transaction-mutation integration tests: 43 passed, including the legacy dividend-preview then DELETE sequence.
- Fifth-round API source/integration TypeScript and changed-file ESLint checks: passed.
- Fifth-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,089 tests passed, 473 skipped.
- Sixth-round transaction-mutation and shared-context integration tests: 43 and 15 passed after correcting the legacy PATCH fixture to leave one eligible buy before moving it past the ex-date.
- Sixth-round mutation preview/run page tests: 3 passed.
- Sixth-round API source/integration TypeScript, web TypeScript, changed-file ESLint, and `git diff --check`: passed.
- Sixth-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,089 tests passed, 473 skipped.
- Sixth-round `npm run test --prefix apps/web`: 86 component/app files with 583 tests passed, followed by 80 feature/lib files with 534 tests passed.
- Current-head CI follow-up: `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/holdings-selection-persistence-aaa.spec.ts` passed 1/1 after correcting the stale row-visibility expectation.
- Seventh-round MCP integration tests: 42 passed, including connector-scope denial, share-capability denial, and authorized durable preview creation.
- Seventh-round preview/run/page tests: 7 passed; changed-file ESLint and API source/integration plus web TypeScript checks passed.
- Seventh-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,090 tests passed, 473 skipped.
- Seventh-round `npm run test --prefix apps/web`: 86 component/app files with 583 tests passed, followed by 80 feature/lib files with 534 tests passed.
- Eighth-round posted-transaction mutation tests: 12 passed, including synchronous wallet snapshot refresh.
- Eighth-round holdings-selection, preference-helper, and transaction-hook tests: 17 passed, including protected-fee choice and full-universe materialization from a scoped table.
- Eighth-round API source/integration TypeScript, web TypeScript, changed-file ESLint, and `git diff --check`: passed.
- Eighth-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,090 tests passed, 473 skipped.
- Eighth-round `npm run test --prefix apps/web`: 86 component/app files with 585 tests passed, followed by 80 feature/lib files with 535 tests passed.
- Ninth-round posted-transaction HTTP and MCP integration tests: 88 passed, including rejection of fractional quantities and sub-cent prices before preview persistence.
- Ninth-round API source/integration TypeScript and changed-file ESLint checks: passed.
- Ninth-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,093 tests passed, 473 skipped.
- Tenth-round posted-transaction owner-access tests: 13 passed, including owner confirmation and denial for an unrelated delegate.
- Tenth-round portfolio holdings-style tests: 8 passed, including explicit compact-view use of the `portfolio.holdings` settings context.
- Tenth-round API/web TypeScript and changed-file ESLint checks: passed.
- Tenth-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,094 tests passed, 473 skipped.
- Tenth-round `npm run test --prefix apps/web`: 86 component/app files with 585 tests passed, followed by 80 feature/lib files with 535 tests passed.
- Eleventh-round posted-transaction mutation tests: 14 passed, including SELL-to-BUY realized P&L removal in preview and committed accounting.
- Eleventh-round API TypeScript and changed-file ESLint checks: passed.
- Eleventh-round `npm run test --prefix apps/api`: 201 files passed, 49 skipped; 2,095 tests passed, 473 skipped.
- Twelfth-round managed Postgres hard-purge tests: 14 passed, including delegated mutation-chain cascade, owner preservation, four FK delete modes, and migration reapplication.
- The first twelfth-round managed run exposed a non-idempotent replacement-constraint name; migration `107` now drops legacy and replacement names before re-adding each cascade.
- Twelfth-round API integration TypeScript, changed-file ESLint, and `git diff --check`: passed.
- Twelfth-round `npm run test:integration:full:host`: 103 files passed; 1,054 tests passed, 1 skipped.
- Thirteenth-round AI draft service tests: 13 passed, including deleted-lineage lookup after the confirmed trade foreign key becomes null.
- Thirteenth-round API TypeScript, changed-file ESLint, and `git diff --check`: passed.
- The thirteenth-round managed Postgres run passed 102 of 103 files and 1,053 tests before the new regression rejected an unsupported control ticker in its fixture. The control trade was changed to supported ticker `2330`; the focused managed Postgres mutation file then passed 1/1 and verifies both retained-link restoration and deleted-lineage lookup by draft-row ID.
- Thirteenth-round exact-head GitHub CI: all 9 checks passed, including both E2E modes.
- Fourteenth-round managed Postgres admin-management file: 15 passed across memory and Postgres, including owner-history preservation, nullable attribution, expected FK delete modes, backend parity, and migration reapplication.
- The first fourteenth-round focused run exposed PostgreSQL's 63-byte truncation of the migration-106 lineage FK name. Migration `108` now explicitly drops that legacy truncated constraint before installing the named `SET NULL` replacement.
- Fourteenth-round full repository typecheck, changed-file ESLint, 27 focused mutation/draft unit tests, and `git diff --check`: passed.
- Fifteenth-round managed admin-management file: 15 passed with the draft batch created by the purged delegate; assertions verify the owner-owned batch, preview, run, and lineage survive, all delegate attribution is null, and all five FK delete modes match the ownership model.
- Fifteenth-round full repository typecheck, memory admin-management tests, changed-file ESLint, and `git diff --check`: passed.
- Sixteenth-round managed admin-management file: 15 passed, including delegated actor anonymization, retained owner history, subsequent owner purge, seven exact FK delete modes, and migration reapplication.
- Sixteenth-round memory admin-management tests, API integration TypeScript, changed-file ESLint, and `git diff --check`: passed; the memory aggregate verifies draft event actor anonymization.

## Waiver

No Linear ticket was provided. The user-approved publication path is:

- Label: `waiver:linear-ticket`
- Approved-by: `@kzokv`
- Scope: `both`
