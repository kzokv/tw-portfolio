# Implementation TODO — KZO-101 + KZO-102: Env Schema Unification + Docker Schema Merge

> Consolidated from grill-me session on 2026-03-21.
> Scope: KZO-101 (env schema unification) + KZO-102 (Docker schema merge + validators).
> Linear tickets: KZO-101, KZO-102
> Branch: `kzo-101`
> PR: single PR, two logically grouped commits.
> **Status: COMPLETE** — all items implemented and tests passing.

---

## Grill Session Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | NEXT_PUBLIC_* in envSchema? | No — leaks web concerns into API. Use `envSchema.pick().extend()` |
| 2 | DEPLOY_ENV location | `dockerCloudSchema` only (not `envSchema`) |
| 3 | Combined PR? | Yes — one PR, 2 commits (one per ticket) |
| 4 | CI guard approach | ESLint `no-restricted-imports` scoped to `env-web.ts` only |
| 5 | CI fixture COOKIE_DOMAIN | `.kzokvdevs.dpdns.org` for both; prod domains corrected to `twp-prod-*` |
| 6 | validatePortConflicts refactor | One function, rename to `validateEnvConstraints`, accept params |
| 7 | dockerLocalSchema ports | Align to `z.coerce.number()` |
| 8 | NODE_ENV validation | `=== "production"` denylist |
| 9 | env-docker.test.ts | Full rewrite |
| 10 | env-metadata merge boundary | `dockerCloudGroups` merged; `webEnvGroups` stays (KZO-103 scope) |
| 11a | webEnvSchema re-export | Yes — re-export from `env-web.ts` |
| 11b | ESLint guard scope | `env-web.ts` only |
| 12 | validateCookieDomainRequired location | `env-docker.ts` (next to schema it validates) |
| 13 | Commit structure | 2 commits — one per ticket |

---

## Commit 1: Unify env schemas (KZO-101)

### 1.1 Define `webEnvSchema` via `pick().extend()` in `env-schema.ts`
- [x] Add to `env-schema.ts`:
  ```typescript
  export const webEnvSchema = envSchema
    .pick({ SESSION_SECRET: true, SESSION_COOKIE_NAME: true })
    .extend({
      NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
      NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
    });
  ```
- [x] Verify: `NEXT_PUBLIC_*` fields are NOT in `envSchema` — only in `webEnvSchema`

### 1.2 Rewrite `env-web.ts`
- [x] Remove standalone `webEnvSchema` definition
- [x] Import `webEnvSchema` from `./env-schema.js`
- [x] Re-export `webEnvSchema`
- [x] Keep `WebEnv = Object.freeze(webEnvSchema.parse(process.env))`
- [x] Verify: file imports ONLY from `./env-schema.js`, never from `./env.js`

### 1.3 Add ESLint `no-restricted-imports` guard
- [x] Add rule in `eslint.config.mjs` scoped to `libs/config/src/env-web.ts`:
  - Restrict imports from `./env.js` and `./env` (with and without extension)
  - Error message: "env-web.ts must not import from env.ts — fs.readFileSync crashes Edge Runtime"
- [x] Verify: importing `./env.js` in `env-web.ts` triggers ESLint error

### 1.4 Delete `apps/web/.env.example`
- [x] Delete `apps/web/.env.example` (contents: `NEXT_PUBLIC_AUTH_MODE`, `NEXT_PUBLIC_API_BASE_URL`)

### 1.5 Update `targets.ts` web import
- [x] Change `webEnvSchema` import from `../../libs/config/src/env-web.js` to `../../libs/config/src/env-schema.js`

### 1.6 Verify
- [x] Build passes (`npm run build`)
- [x] Lint passes (`npm run lint`)
- [x] Typecheck passes
- [x] Edge Runtime safe — `proxy.ts` and `auth.ts` work (no `fs` import in Edge)
- [x] Existing tests pass

---

## Commit 2: Merge Docker schemas + validators (KZO-102)

### 2.1 Merge `dockerDevSchema` + `dockerProdSchema` → `dockerCloudSchema`
- [x] Create `dockerCloudSchema` in `env-docker.ts`:
  - All fields from `dockerDevSchema` (they're identical to `dockerProdSchema`)
  - Add `DEPLOY_ENV: z.enum(["dev", "production"])`
  - `COOKIE_DOMAIN`: change from `z.string().optional().default(...)` to `z.string()` (required, no default)
  - `SESSION_COOKIE_NAME`: keep default `"g_auth_session"` (no `__Host-` for subdomain sharing)
  - Remove domain defaults (`PUBLIC_DOMAIN_WEB`, `PUBLIC_DOMAIN_API` — no defaults, env:setup provides them)
- [x] Delete `dockerDevSchema` and `dockerProdSchema` exports
- [x] Export `dockerCloudSchema`

### 2.2 Align `dockerLocalSchema` port types
- [x] Change port fields from `z.string()` to `z.coerce.number()`

### 2.3 Add `validateCookieDomainRequired()` in `env-docker.ts`
- [x] Accepts `{ PUBLIC_DOMAIN_WEB, PUBLIC_DOMAIN_API, COOKIE_DOMAIN }` input
- [x] When `PUBLIC_DOMAIN_WEB` and `PUBLIC_DOMAIN_API` have different hostnames and `COOKIE_DOMAIN` is missing → throw
- [x] When domains share a parent and `COOKIE_DOMAIN` is set → pass

### 2.4 Rename `validatePortConflicts()` → `validateEnvConstraints()`
- [x] Rename function in `env.ts`
- [x] Add input params with default fallback to `_parsed` (same pattern as `validateHostConsistency`)
- [x] Input type covers: `API_PORT`, `WEB_PORT`, `DB_PORT`, `REDIS_PORT`, `AUTH_MODE`, `NODE_ENV`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`
- [x] Update all callers of `validatePortConflicts` → `validateEnvConstraints`

### 2.5 Fix NODE_ENV validation
- [x] In `validateEnvConstraints()`: change `dev_bypass` restriction from allowlist (`["development"]`) to denylist (`NODE_ENV === "production"`)
- [x] Allows `dev_bypass` in `NODE_ENV=test` (E2E CI)

### 2.6 Update `env-metadata.ts`
- [x] Merge `dockerDevGroups` + `dockerProdGroups` → `dockerCloudGroups`
- [x] Add `DEPLOY_ENV` to the "Application" group in `dockerCloudGroups`
- [x] Delete `dockerDevGroups` and `dockerProdGroups` exports
- [x] Keep `webEnvGroups` (KZO-103 scope)

### 2.7 Update `targets.ts` Docker targets
- [x] Replace `dockerDevSchema` → `dockerCloudSchema` for `docker:dev` target
- [x] Replace `dockerProdSchema` → `dockerCloudSchema` for `docker:prod` target
- [x] Replace `dockerDevGroups` → `dockerCloudGroups` for `docker:dev` target
- [x] Replace `dockerProdGroups` → `dockerCloudGroups` for `docker:prod` target

### 2.8 Update CI fixtures
- [x] `infra/docker/fixtures/env.dev.ci`:
  - Add `COOKIE_DOMAIN=.kzokvdevs.dpdns.org`
  - Add `DEPLOY_ENV=dev`
- [x] `infra/docker/fixtures/env.prod.ci`:
  - Fix `PUBLIC_DOMAIN_WEB=twp-prod-web.kzokvdevs.dpdns.org`
  - Fix `PUBLIC_DOMAIN_API=twp-prod-api.kzokvdevs.dpdns.org`
  - Add `COOKIE_DOMAIN=.kzokvdevs.dpdns.org`
  - Add `DEPLOY_ENV=production`

### 2.9 Rewrite `env-docker.test.ts`
- [x] Delete existing tests for `dockerDevSchema` / `dockerProdSchema`
- [x] Add `dockerCloudSchema` tests:
  - Requires `COOKIE_DOMAIN` (no default)
  - Requires `DEPLOY_ENV` (enum: dev, production)
  - Accepts valid cloud config
  - Rejects missing required fields
- [x] Add `validateCookieDomainRequired` tests:
  - Throws when subdomains differ but COOKIE_DOMAIN unset
  - Passes when subdomains differ and COOKIE_DOMAIN set
  - Passes when domains are identical (same-host deploy)

### 2.10 Add `validateEnvConstraints` unit tests
- [x] Port uniqueness: duplicate ports → throws
- [x] Port uniqueness: unique ports → passes
- [x] dev_bypass + NODE_ENV=production → throws
- [x] dev_bypass + NODE_ENV=development → passes
- [x] dev_bypass + NODE_ENV=test → passes (the fix)
- [x] oauth + missing GOOGLE_CLIENT_ID → throws
- [x] oauth + all required vars present → passes

### 2.11 Verify
- [x] Build passes (`npm run build`)
- [x] Lint passes (`npm run lint`)
- [x] Typecheck passes
- [x] All unit tests pass
- [x] All integration tests pass
- [x] E2E bypass suite passes
- [x] E2E oauth suite passes

---

## Out of Scope (tracked for future PRs)

| Item | Tracked In |
|------|-----------|
| Reduce env-setup targets from 9 → 4 (remove web targets, merge root targets) | KZO-103 |
| Create unified `.env.example` | KZO-103 |
| Remove `webEnvGroups` from env-metadata.ts | KZO-103 |
| Demo user feature (DEMO_MODE_ENABLED, /auth/demo/start) | Doc 03 Section 2 |
| Dev experience (npm scripts, dev.sh, help-printers) | Doc 02 Phase 2 |
| Test hardening (E2E CI jobs, mock OAuth lifecycle) | Doc 02 Phase 3 |

---

## Key Rules (from .claude/rules/)

When implementing, respect these guardrails:

1. **Do NOT modify `app.ts` or `registerRoutes.ts` to accommodate test setup** — if tests fail due to auth mode, use `vi.mock("@tw-portfolio/config")` at the test-file level. See `.claude/rules/vitest-auth-mode-override.md`.
2. **API route handlers use `getSession()` + manual 401**, never `requireSession()`. See `.claude/rules/api-route-session-guard.md`.
3. **If a fix requires production code changes for test-only reasons**, send `[QUESTION]` to the Architect. See `.claude/rules/fixer-scope-guardrail.md`.

---

## Files In Scope

| File | Action |
|------|--------|
| `libs/config/src/env-schema.ts` | Add `webEnvSchema` via `pick().extend()` |
| `libs/config/src/env-web.ts` | Rewrite — thin import/parse/export |
| `libs/config/src/env-docker.ts` | Merge schemas, add `validateCookieDomainRequired`, align ports |
| `libs/config/src/env.ts` | Rename + refactor `validateEnvConstraints`, NODE_ENV fix |
| `libs/config/src/env-metadata.ts` | Merge groups, add DEPLOY_ENV |
| `libs/config/test/env-docker.test.ts` | Full rewrite |
| `libs/config/test/env.test.ts` | Add `validateEnvConstraints` tests |
| `scripts/env-setup/targets.ts` | Update imports + target schemas/groups |
| `eslint.config.mjs` | Add `no-restricted-imports` for env-web.ts |
| `apps/web/.env.example` | Delete |
| `infra/docker/fixtures/env.dev.ci` | Add COOKIE_DOMAIN, DEPLOY_ENV |
| `infra/docker/fixtures/env.prod.ci` | Fix domains, add COOKIE_DOMAIN, DEPLOY_ENV |
