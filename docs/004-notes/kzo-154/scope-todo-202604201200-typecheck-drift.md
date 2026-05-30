---
slug: kzo-154
source: scope-grill
created: 2026-04-20
tickets: [KZO-154]
required_reading: []
superseded_by: null
---

# Todo: KZO-154 — Fix typecheck coverage for apps/api/test/integration/ and test/unit/

> **For agents starting a fresh session:** read the KZO-154 Linear ticket and
> `.claude/rules/full-test-suite.md` + `.claude/rules/code-review-before-pr.md`
> before starting.

## Context

`apps/api/test/tsconfig.json` currently covers only `http/**/*.ts`. Integration and
unit test files are invisible to `npm run typecheck`, creating silent type drift.

**Hidden constraint:** widening include alone is not sufficient. Integration/unit tests
dynamically import from `../../src/app.js`, which pulls in `src/app.ts` transitively.
`src/types/fastify.d.ts` (Fastify module augmentation) must be in scope or ~100 false
errors appear from `src/` files. Solution: include `../../src/**/*.d.ts` in each new
test tsconfig. Only one `.d.ts` exists in `src/`: `src/types/fastify.d.ts`.

**Error count at scope-grill time:** 23 errors across 10 files (drifted from the ~14
at KZO-145 deferral due to KZO-148 impersonation test landing untypechecked).

## Implementation Steps

### Phase 1 — tsconfig infrastructure

- [x] Create `apps/api/test/integration/tsconfig.json`
      - `extends: "../../../../tsconfig.base.json"`
      - `compilerOptions: { noEmit: true, declaration: false, module: "NodeNext", moduleResolution: "NodeNext" }`
      - `include: ["**/*.ts", "../../src/**/*.d.ts"]`
- [x] Create `apps/api/test/unit/tsconfig.json` — identical structure to above
- [x] Modify `apps/api/test/tsconfig.json` — add `"globalTeardown.ts"` to `include`
      alongside `"http/**/*.ts"`
- [x] Create `apps/api/tsconfig.config.json`
      - `extends: "../../tsconfig.base.json"`
      - `compilerOptions: { noEmit: true, declaration: false, module: "NodeNext", moduleResolution: "NodeNext" }`
      - `include: ["vitest.config.ts"]`
- [x] Update root `package.json` typecheck script — append after existing entries:
      `&& npx tsc --noEmit -p apps/api/test/integration/tsconfig.json`
      `&& npx tsc --noEmit -p apps/api/test/unit/tsconfig.json`
      `&& npx tsc --noEmit -p apps/api/tsconfig.config.json`

### Phase 2 — Error fixes

- [x] `apps/api/vitest.config.ts:14` — add `// @ts-expect-error` above `globalTeardown`
      (property absent from `InlineConfig` in installed Vitest version; works at runtime)
- [x] `integration/catalogSync.integration.test.ts:194` — `InstrumentDef` not found;
      import the type or replace with its inline equivalent
- [x] `integration/dividend-enrichment.integration.test.ts:200` — remove invalid cast
      of `DividendEvent | undefined` to `Record<string, unknown>` (index signature mismatch)
- [x] `integration/impersonation.integration.test.ts` (lines 102, 140, 326, 364, 401) —
      cast `response.headers as Record<string, string | string[] | undefined>` at each
      call site; `OutgoingHttpHeaders` allows `number` values which the helper rejects
- [x] `integration/postgres-migrations.integration.test.ts` (lines 1403, 1416, 1655, 1667) —
      add missing `version` and `sourceCompositionStatus` fields to `DividendLedgerEntry`
      fixture objects
- [x] `integration/role-enforcement.integration.test.ts` (lines 46, 50, 51) — fix
      `unknown` not assignable to `InjectPayload`; fix `.statusCode`/`.json` access on
      `void & Promise<Response> & Chain`
- [x] `integration/sse.integration.test.ts:468` — fix spread argument; must be tuple
      type or rest parameter
- [x] `unit/admin-user-management.test.ts` (lines 596, 598, 599) — same
      `InjectPayload`/`Chain` pattern as role-enforcement
- [x] `unit/anonymous-share-routes.test.ts:11` — `null` not assignable to
      `string | undefined`; change `null` to `undefined` or widen type
- [x] `unit/anonymous-share-token-persistence.test.ts:17` — same `null` issue
- [x] `unit/catalog-sync-worker.test.ts` (lines 32, 70, 98) — add `createRefreshBatch`
      mock to the `Pick<Persistence, ...>` object at all three describe blocks

### Phase 3 — Verification

- [x] `npm run typecheck` exits 0 with all new tsconfigs in the chain
- [x] `npm run test --prefix apps/api` still green (no regressions from type fixes)

## Out of Scope

- `apps/api/test/helpers/fixtures.ts` — transitively covered, clean, no action needed
- Project references refactor (`composite: true`) — future optimization
- Any other `apps/api/` config files not discovered in this session

## References

- Linear: [KZO-154](https://linear.app/kzokv/issue/KZO-154)
