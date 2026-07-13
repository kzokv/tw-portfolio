# Playwright E2E Runs the Pre-Built Standalone Bundle — Rebuild After Source Edits

The Playwright E2E webServer starts the **pre-built** Next.js standalone bundle, not a dev server with HMR:

```ts
// libs/test-framework/src/config/createPlaywrightConfig.ts (paraphrased)
const webServer = {
  command: "... cd apps/web && NODE_ENV=test PORT=${WEB_PORT:-3333} node .next/standalone/apps/web/server.js",
  ...
};
```

This means **changes to source code under `apps/web/` are NOT picked up** unless `apps/web/.next/standalone/` is regenerated. The test will silently exercise the OLD bundle — without any error message that hints at staleness.

## Symptoms

- A test assertion that recently passed (after a source change) fails with "element not found" or "wrong DOM shape".
- Page snapshots show the OLD layout/structure even though the source file clearly has the new shape.
- Re-reading the source confirms the change is on disk; running `next build` fixes the failure.
- Especially common when iterating fast: `npx playwright test ...` directly against an already-running webServer or against a stale `.next/standalone/` from a previous full run.

## Wrong invocation

```bash
# Edit apps/web/components/...
# Re-run only the affected spec → tests run against OLD bundle
npx playwright test --config tests/e2e/playwright.oauth.config.ts specs-oauth/foo.spec.ts
```

## Right invocation

The repo's npm scripts already chain a build:

```bash
# Suite 7 — full OAuth E2E (rebuilds web + relevant libs first)
npm run test:e2e:oauth:mem --prefix apps/web

# Suite 6 — full bypass E2E (also rebuilds)
npm run test:e2e:bypass:mem --prefix apps/web

# Suite 8 — API HTTP (rebuilds api + libs)
npm run test:http --prefix apps/api
```

For a single-spec re-run after a source edit, build first then call playwright:

```bash
NEXT_PUBLIC_AUTH_MODE=oauth NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 \
  npm run build -w @vakwen/web

npx playwright test --config tests/e2e/playwright.oauth.config.ts specs-oauth/foo.spec.ts
```

The npm scripts pin both `NEXT_PUBLIC_AUTH_MODE` and `NEXT_PUBLIC_API_BASE_URL` because Next.js inlines `NEXT_PUBLIC_*` at build time — see `.claude/rules/`-adjacent context in `docs/001-architecture/web-frontend.md` § "Build-Time vs Runtime Variables". Running `npm run build -w @vakwen/web` without these env vars will produce a bundle that points at the wrong API URL.

## Memory E2E Scripts Must Not Re-Source Root `.env.local`

For `*:mem` E2E scripts, do not source the repo-root `.env.local` after setting the memory-mode environment. Local development files commonly contain `PERSISTENCE_BACKEND=postgres`, `WEB_PORT=3000`, or other host-specific values, and a late `. ../../.env.local` can silently override the intended `PERSISTENCE_BACKEND=memory` run.

```json
// ✅ Correct — explicit memory env flows into the Playwright webServer config.
"test:e2e:oauth:mem": "NEXT_PUBLIC_AUTH_MODE=oauth NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL:-http://localhost:${API_PORT:-4000}} npm run build ... && npx playwright test --config=tests/e2e/playwright.oauth.config.ts"

// ❌ Wrong — root .env.local can switch the run back to postgres or another port.
"test:e2e:oauth:mem": "NEXT_PUBLIC_AUTH_MODE=oauth ... npm run build ... && [ -f ../../.env.local ] && set -a && . ../../.env.local && set +a; npx playwright test ..."
```

If a Playwright config is explicitly for memory mode, pin `PERSISTENCE_BACKEND: "memory"` in `webServer` env overrides rather than inheriting `process.env.PERSISTENCE_BACKEND`.

## When to suspect a stale bundle

- A spec that worked yesterday fails after a source edit, but the git diff looks correct.
- Page snapshot YAML shows DOM shapes that don't match the current JSX.
- `cardDragHandleIsVisible("X")` (or similar) fails when X exists in the source but not in the render.
- E2E and unit/typecheck disagree: typecheck passes (source is consistent), unit may pass, E2E fails as if old code is running.

**Before debugging the test or the source**, rerun `npm run build -w @vakwen/web` (or use the suite's npm wrapper) and re-run.

## Why

Discovered during KZO-162 follow-up. After restructuring the transactions section to wrap `AddTransactionCard` in `<SortableCardGrid>`, a single-spec re-run via `npx playwright test` failed because the test asserted on the new 3-card layout but the standalone bundle still rendered the old 2-column composition. The error message ("element not found: card-drag-handle-transactions-add") looked like a code bug — wasted ~10 minutes inspecting the source and the SortableCardGrid component before realizing the bundle was stale.

## How to apply

- For any iteration loop that involves editing `apps/web/**` and re-running E2E: prefer the `npm run test:e2e:*` scripts (they build first).
- If you must call `npx playwright test` directly (faster iteration on a single spec), explicitly `npm run build -w @vakwen/web` between source edits.
- Same principle for `apps/api/**` edits + `npm run test:http` — but the API rebuild is much faster and more obvious in the script chain.
- Add a one-line note in any new debugging session: "Have I rebuilt since the last source change?" before treating an E2E failure as a real bug.

## 2026-07-13 Addendum: Serialize Shared `.next` Writers

Agents in the same worktree share `apps/web/.next`. A `next build` removes and rewrites that tree, so it must not run concurrently with another agent's Playwright server, production server, or separate `next build`. Separate TCP ports do not isolate build artifacts.

Before starting a build, identify the current `.next` owner and wait for its test/server run to finish. The owner must explicitly release the bundle before another agent rebuilds. If a concurrent build is interrupted, treat the bundle as invalid: stop consumers, rebuild cleanly, then restart. Do not classify resulting missing standalone modules or chunks as product failures.

This rule was validated bidirectionally during Dividends Review performance acceptance: a performance build removed QA's standalone server, and a QA build removed the performance server's chart chunk. Both used separate ports; only serialization plus a clean rebuild restored trustworthy results.
