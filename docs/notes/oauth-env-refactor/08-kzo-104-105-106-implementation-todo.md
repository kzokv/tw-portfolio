# Implementation TODO — KZO-104 + KZO-105 + KZO-106: Dev Experience Scripts

> Consolidated from grill-me session on 2026-03-22.
> Scope: dev npm scripts, dev-docker.sh, E2E script renames, e2eEnvSchema, localhost unification, test runner.
> Linear tickets: KZO-104, KZO-105, KZO-106
> Branch: `kzo-104`
> PR: single PR, 3 commits (one per ticket).

---

## Grill Session Decisions

| # | Question | Resolution |
|---|----------|-----------|
| Q1 | KZO-104 item 4 (auth.ts fallback) | Remove from scope — already shipped in KZO-98 |
| Q2 | npm script env passing | Env var prefix: `AUTH_MODE=... bash scripts/dev.sh` |
| Q7 | 127.0.0.1 vs localhost | Fix root cause: bind mock OAuth to `0.0.0.0`, unify on `localhost` (debate: unanimous) |
| Q8 | e2eEnvSchema scope | Scoped Option A: replace TestEnv's `process.env` reads only (debate: unanimous) |
| Q9 | Banner logic | Shared `print_banner` function in `scripts/lib/banner.sh` |
| Q10 | Help-printer | Single `scripts/help.sh` with section argument (`dev` / `e2e` / `test`) |
| Q11 | Banner script name | Positional arg `$1`; omit inapplicable vars; mask secrets `****`; after Node check (debate: unanimous) |
| Q12 | Commit structure | 3 commits: one per ticket, shared infra in KZO-104 |
| Q13 | Post-worktree auth prompt | TTY check + timeout → skip with warning |
| Q14 | dev-docker.sh `--migrate` | Activates compose `migrate` profile |
| Q15 | Docker script renames | `dry-run`→`dry`, `yes`→`force` confirmed |
| Q16a | Web `test` script | Becomes `vitest run` (unit tests); remove redundant `test:unit` |
| Q16b | Help script structure | Single `scripts/help.sh` with section argument |
| Q17 | e2eEnvSchema location | Same file: `libs/config/src/test.ts` |
| Q18 | Old `docker:*` scripts | Hard-remove (no aliases) |
| Q19 | Root `test` script | Unchanged: `npm run test --workspaces` |
| Q20 | Unified test runner | `scripts/test.sh` with flags + `test:all` npm script |
| Q21 | `test:all` scope | unit + integration (no migrations) + e2e:bypass |
| — | `--full` flag | Upgrades integration to `integration:full:host` (managed DB, includes migrations) |
| — | Integration CI rename | `ci:host` → `full:host`, `ci:container` → `full:container` |

---

## Commit 1: KZO-104 — Dev mode npm scripts + dev.sh refactor

### 1.1 Create `scripts/lib/banner.sh` (shared function)

- [ ] Create `scripts/lib/` directory
- [ ] Create `scripts/lib/banner.sh` with `print_banner <name> [context]` function
- [ ] Banner format:
  ```
  ── dev:local:oauth:pg ──────────────────────────

    Mode-specific:
      AUTH_MODE              oauth
      PERSISTENCE_BACKEND    postgres
      DB_URL                 postgres://...

    Inherited:
      NODE_ENV               development
      API_PORT               4000
      WEB_PORT               3333
      ...

  ────────────────────────────────────────────────
  ```
- [ ] Variable classification logic:
  - Mode-specific: `AUTH_MODE`, `PERSISTENCE_BACKEND`, and vars dependent on their values
  - Inherited: everything else from `.env.local`
- [ ] Omit inapplicable vars (e.g., `DB_URL` when `PERSISTENCE_BACKEND=memory`)
- [ ] Mask sensitive values with `****` (set) or `<not set>` (unset):
  - `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`
- [ ] Banner prints after Node check + env resolution, before process startup

### 1.2 Create `scripts/help.sh`

- [ ] Create `scripts/help.sh` with argument dispatch (`dev` / `e2e` / `test`)
- [ ] `dev` section:
  ```
  Available dev commands:

    dev:local:bypass:mem       Fastest iteration — no auth, in-memory
    dev:local:bypass:pg        Bypass auth, real Postgres
    dev:local:oauth:mem        Google OAuth, in-memory
    dev:local:oauth:pg         Google OAuth, Postgres (closest to prod)
    dev:docker                 Docker Compose local stack (oauth + postgres)
  ```
- [ ] `e2e` section:
  ```
  Available test:e2e commands:

    test:e2e:bypass:mem        dev_bypass E2E suite, in-memory
    test:e2e:oauth:mem         OAuth E2E suite, in-memory
    test:e2e:ci:bypass:mem     CI variant (GitHub Actions)
    test:e2e:show-report       Open Playwright HTML report
  ```
- [ ] `test` section:
  ```
  Available test commands:

    Local:
      test:all                       Unit + integration + E2E bypass
      test:unit                      Unit tests (all workspaces)
      test:integration               Integration tests (no DB migrations)
      test:integration:full:host     Full integration with managed DB (local)
      test:integration:full:container  Full integration (from inside container)
      test:e2e:bypass:mem            E2E dev_bypass suite
      test:e2e:oauth:mem             E2E OAuth suite (requires refresh token)

    Flags for test.sh:
      --all                          Run unit + integration + e2e:bypass
      --full                         Upgrade integration to include DB migrations
      --e2e-oauth                    Include OAuth E2E suite
  ```

### 1.3 Update `scripts/dev.sh`

- [ ] Accept `$1` as script name for banner header (default: `dev`)
- [ ] Source `scripts/lib/banner.sh`
- [ ] Call `print_banner "$1"` after env resolution, before starting processes
- [ ] Keep existing: Node version check, `.env.local` loading, `NEXT_PUBLIC_*` derivation
- [ ] `AUTH_MODE` and `PERSISTENCE_BACKEND` are already set via env var prefix from npm scripts — dev.sh reads them naturally

### 1.4 Add npm scripts to root `package.json`

- [ ] Replace `"dev": "bash scripts/dev.sh"` with `"dev": "bash scripts/help.sh dev"`
- [ ] Add 4 `dev:local:*` scripts:
  ```json
  "dev:local:bypass:mem": "AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=memory bash scripts/dev.sh dev:local:bypass:mem",
  "dev:local:bypass:pg": "AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=postgres bash scripts/dev.sh dev:local:bypass:pg",
  "dev:local:oauth:mem": "AUTH_MODE=oauth PERSISTENCE_BACKEND=memory bash scripts/dev.sh dev:local:oauth:mem",
  "dev:local:oauth:pg": "AUTH_MODE=oauth PERSISTENCE_BACKEND=postgres bash scripts/dev.sh dev:local:oauth:pg"
  ```

### 1.5 Verify

- [ ] `npm run dev` prints help listing
- [ ] `npm run dev:local:bypass:mem` starts with correct banner (AUTH_MODE=dev_bypass, PERSISTENCE_BACKEND=memory)
- [ ] `npm run dev:local:oauth:pg` starts with correct banner (AUTH_MODE=oauth, PERSISTENCE_BACKEND=postgres)
- [ ] Banner omits DB_URL in memory mode
- [ ] Banner masks SESSION_SECRET
- [ ] Fresh browser on dev:local:bypass:mem shows dashboard (not /login redirect)
- [ ] E2E tests still pass

---

## Commit 2: KZO-105 — Docker dev script + utility renames

### 2.1 Create `scripts/dev-docker.sh`

- [ ] Source `infra/docker/.env.local` (if exists)
- [ ] Source `scripts/lib/banner.sh`
- [ ] Call `print_banner "dev:docker" docker`
- [ ] Accept `--migrate` flag:
  - Without flag: `docker compose -f infra/docker/docker-compose.local.yml up --build`
  - With flag: `docker compose -f infra/docker/docker-compose.local.yml --profile migrate up --build`
- [ ] Ctrl+C → `docker compose down`
- [ ] Add help text: `--migrate` runs the migration profile

### 2.2 Add/rename npm scripts in root `package.json`

- [ ] Add `"dev:docker": "bash scripts/dev-docker.sh"`
- [ ] Rename Docker utility scripts:
  ```json
  "dev:docker:cleanup": "bash scripts/docker-cleanup.sh",
  "dev:docker:cleanup:dry": "bash scripts/docker-cleanup.sh --dry-run",
  "dev:docker:cleanup:force": "bash scripts/docker-cleanup.sh --yes",
  "dev:docker:validate": "bash infra/scripts/validate-local.sh",
  "dev:docker:validate:teardown": "bash infra/scripts/validate-local.sh --teardown"
  ```
- [ ] Remove old scripts:
  - `docker:cleanup`
  - `docker:cleanup:dry-run`
  - `docker:cleanup:yes`
  - `docker:validate`
  - `docker:validate:teardown`

### 2.3 Update `help.sh dev` section

- [ ] Add `dev:docker` and Docker utilities to the dev help listing:
  ```
    dev:docker                 Docker Compose local stack (oauth + postgres)
    dev:docker --migrate       Docker Compose + run DB migrations
    dev:docker:cleanup         Clean up Docker images/containers
    dev:docker:cleanup:dry     Dry run cleanup
    dev:docker:cleanup:force   Auto-confirm cleanup
    dev:docker:validate        Validate local compose config
    dev:docker:validate:teardown  Validate then tear down
  ```

### 2.4 Verify

- [ ] `npm run dev:docker` starts local Docker stack with banner
- [ ] Ctrl+C tears down cleanly
- [ ] `npm run dev:docker -- --migrate` runs migration profile
- [ ] All `dev:docker:*` utility scripts work under new names
- [ ] Old `docker:*` names are removed
- [ ] `npm run docker:cleanup` → `missing script` error

---

## Commit 3: KZO-106 — E2E script renames + test infrastructure

### 3.1 Add `e2eEnvSchema` to `libs/config/src/test.ts`

- [ ] Add Zod schema for env-read fields:
  ```typescript
  export const e2eEnvSchema = z.object({
    HOST: z.string().default("localhost"),
    MOCK_OAUTH_PORT: z.coerce.number().default(4445),
    API_PORT: z.coerce.number().default(4000),
    WEB_PORT: z.coerce.number().default(3333),
    SESSION_COOKIE_NAME: z.string().default("__Host-g_auth_session"),
    GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
    GOOGLE_TOKEN_URL: z.string().optional(),
  });
  ```
- [ ] Refactor `TestEnv` to read from `e2eEnvSchema.parse(process.env)` for env-read fields
- [ ] Keep hardcoded oauth mock credentials unchanged (clientId, clientSecret, sessionSecret)
- [ ] Keep computed properties unchanged (mockTokenUrl, googleRedirectUri, appBaseUrl, etc.)
- [ ] Keep builder methods unchanged (apiServerEnv(), webServerEnv(), loadDotEnvSync())
- [ ] Export `e2eEnvSchema` for external use

### 3.2 Unify on `localhost` — fix mock OAuth server

- [ ] Find `mock-oauth-server.mjs` and change bind from `"127.0.0.1"` to `"0.0.0.0"`
- [ ] Update `flows.ts`:
  - Remove `E2E_BASE_URL` / `E2E_API_BASE_URL` env var reads
  - Replace hardcoded `127.0.0.1` URLs with `TestEnv.appBaseUrl` / `TestEnv.apiBaseUrl`
  - Remove the `// CRITICAL (P6)` comment (no longer applicable)
- [ ] Verify: both E2E suites pass (dev_bypass + OAuth)

### 3.3 Rename E2E npm scripts in `apps/web/package.json`

- [ ] Change `"test"` from Playwright to `"vitest run"` (unit tests)
- [ ] Remove `"test:unit"` (redundant — same as `test`)
- [ ] Rename:
  ```json
  "test:e2e:bypass:mem": "<current test value>",
  "test:e2e:oauth:mem": "<current test:e2e:oauth value>",
  "test:e2e:ci:bypass:mem": "<current test:e2e:ci value>"
  ```
- [ ] Keep `test:e2e:show-report` unchanged

### 3.4 Rename E2E npm scripts in root `package.json`

- [ ] Change `"test:e2e"` to help-printer: `"bash scripts/help.sh e2e"`
- [ ] Rename:
  ```json
  "test:e2e:bypass:mem": "npm run test:e2e:bypass:mem -w @tw-portfolio/web",
  "test:e2e:oauth:mem": "npm run test:e2e:oauth:mem -w @tw-portfolio/web",
  "test:e2e:ci:bypass:mem": "npm run test:e2e:ci:bypass:mem -w @tw-portfolio/web"
  ```
- [ ] Remove old names: `test:e2e:oauth`, `test:e2e:ci`
- [ ] Keep `test:e2e:show-report` unchanged

### 3.5 Rename integration CI scripts

- [ ] Rename npm scripts in root `package.json`:
  ```json
  "test:integration:full:host": "bash scripts/test-integration-ci-host.sh",
  "test:integration:full:container": "bash scripts/test-integration-ci-container.sh"
  ```
- [ ] Remove old names: `test:integration:ci:host`, `test:integration:ci:container`
- [ ] Update `log_ci()` label in `scripts/test-integration-ci-lib.sh`:
  ```bash
  log_ci() {
    echo "[test:integration:full:${INTEGRATION_CI_MODE}] $*"
  }
  ```
- [ ] Update help text in `scripts/test-integration-ci-host.sh` and `scripts/test-integration-ci-container.sh`
- [ ] Update retired `scripts/test-integration-ci.sh` error message to reference new names

### 3.6 Create `scripts/test.sh` (unified test runner)

- [ ] Create `scripts/test.sh` with flag-based suite selection:
  ```bash
  FLAGS: --all, --unit, --integration, --e2e, --e2e-oauth, --full
  ```
- [ ] `--all` = `--unit --integration --e2e`
- [ ] `--full` upgrades `--integration` to run `test:integration:full:host` (managed DB)
- [ ] `--e2e-oauth` adds OAuth E2E suite
- [ ] Individual flags can be combined: `--unit --e2e`
- [ ] No flags → print help (reuse `scripts/help.sh test`)
- [ ] Exit on first suite failure (fail-fast)

### 3.7 Add `test:all` npm script to root `package.json`

- [ ] Add: `"test:all": "bash scripts/test.sh --all"`

### 3.8 Update post-worktree hook

- [ ] Add `auth:refresh-token` prompt with TTY check + timeout:
  ```bash
  if [ -t 0 ]; then
    echo ""
    echo "→ To run OAuth E2E tests, you need a Google refresh token."
    read -t 10 -rp "→ Run auth:refresh-token now? [Y/n] " ans || {
      echo ""
      echo "⚠ Timed out — skipping auth:refresh-token."
      echo "  Run manually later: npm run auth:refresh-token"
      ans="n"
    }
    if [[ "${ans:-Y}" =~ ^[Yy] ]]; then
      npm run auth:refresh-token
    fi
  else
    echo "→ Non-interactive mode: skipping auth:refresh-token."
    echo "  Run manually if needed: npm run auth:refresh-token"
  fi
  ```

### 3.9 Update `help.sh` test section

- [ ] Add `test` section to `scripts/help.sh` (see section 1.2 above)

### 3.10 Verify

- [ ] `npm run test:e2e` prints help listing
- [ ] `npm run test:e2e:bypass:mem` runs bypass E2E suite
- [ ] `npm run test:e2e:oauth:mem` runs OAuth E2E suite
- [ ] `npm run test:e2e:ci:bypass:mem` runs CI bypass suite
- [ ] `npm test` at root runs all unit tests (no E2E)
- [ ] `npm test` in `apps/web` runs vitest (not Playwright)
- [ ] `npm run test:all` runs unit + integration + e2e:bypass
- [ ] `bash scripts/test.sh --all --full` runs with managed DB
- [ ] `npm run test:integration:full:host` runs full integration suite
- [ ] `npm run test:integration:full:container` runs container mode
- [ ] Old script names (`docker:cleanup`, `test:e2e:oauth`, `test:integration:ci:host`) return `missing script`
- [ ] Mock OAuth server binds to `0.0.0.0`
- [ ] `flows.ts` uses `TestEnv.appBaseUrl` (no `127.0.0.1`)
- [ ] Post-worktree hook prompts for auth:refresh-token (TTY) or prints reminder (non-interactive)
- [ ] e2eEnvSchema validates with clear error messages

---

## Files In Scope

### Commit 1 — KZO-104

| File | Action |
|------|--------|
| `scripts/lib/banner.sh` | Create — shared `print_banner` function |
| `scripts/help.sh` | Create — help-printer with `dev` / `e2e` / `test` sections |
| `scripts/dev.sh` | Modify — accept `$1`, source banner.sh, call print_banner |
| `package.json` | Modify — replace `dev`, add 4 `dev:local:*` scripts |

### Commit 2 — KZO-105

| File | Action |
|------|--------|
| `scripts/dev-docker.sh` | Create — Docker compose wrapper with `--migrate` flag |
| `package.json` | Modify — add `dev:docker`, rename `docker:*` → `dev:docker:*`, remove old names |

### Commit 3 — KZO-106

| File | Action |
|------|--------|
| `libs/config/src/test.ts` | Modify — add `e2eEnvSchema`, refactor TestEnv to read from schema |
| `apps/web/tests/e2e/helpers/flows.ts` | Modify — remove 127.0.0.1, use TestEnv URLs, remove E2E_BASE_URL/E2E_API_BASE_URL |
| `apps/web/tests/e2e/helpers/mock-oauth-server.mjs` (or similar) | Modify — bind to `0.0.0.0` |
| `apps/web/package.json` | Modify — `test` → vitest, remove `test:unit`, rename E2E scripts |
| `package.json` | Modify — rename E2E + integration scripts, add `test:all`, update `test:e2e` to help-printer |
| `scripts/test.sh` | Create — unified test runner with flags |
| `scripts/test-integration-ci-host.sh` | Modify — update help text |
| `scripts/test-integration-ci-container.sh` | Modify — update help text |
| `scripts/test-integration-ci-lib.sh` | Modify — update log label |
| `scripts/test-integration-ci.sh` | Modify — update retired error message |
| `.hooks/post-worktree-create.sh` | Modify — add auth:refresh-token prompt with timeout |

---

## Out of Scope

| Item | Tracked In |
|------|-----------|
| Demo user feature (DEMO_MODE_ENABLED, /auth/demo/start) | KZO-107 |
| Demo user frontend (login page "Try it?" button) | KZO-108 |
| Add E2E jobs to CI workflow | KZO-109 |
| Add validation unit tests + auth regression tests | KZO-110 |
| e2eEnvSchema for GOOGLE_OAUTH_REFRESH_TOKEN validation at Playwright startup | Future (schema added here, validation wiring is follow-up) |

---

## Key Rules (from .claude/rules/)

When implementing, respect these guardrails:

1. **Do NOT modify `app.ts` or `registerRoutes.ts` to accommodate test setup** — if tests fail due to auth mode, use `vi.mock("@tw-portfolio/config")` at the test-file level. See `.claude/rules/vitest-auth-mode-override.md`.
2. **API route handlers use `getSession()` + manual 401**, never `requireSession()`. See `.claude/rules/api-route-session-guard.md`.
3. **If a fix requires production code changes for test-only reasons**, send `[QUESTION]` to the Architect. See `.claude/rules/fixer-scope-guardrail.md`.

---

## Debate References

| Question | Debate file | Outcome |
|----------|------------|---------|
| Q7: localhost unification | `debates/q7-localhost-unification.md` | Unanimous Option A — bind `0.0.0.0` |
| Q8: e2eEnvSchema scope | `debates/q8-e2e-env-schema.md` | Unanimous scoped Option A |
| Q11: banner design | `debates/q11-dev-banner-design.md` | Unanimous Option A — positional arg |
