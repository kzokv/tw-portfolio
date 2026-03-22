# Transition Guide — OAuth & Env Refactor Arc

> Covers: KZO-98, KZO-99, KZO-100, KZO-101, KZO-102, KZO-103
> Date: 2026-03-22
> Status: Frozen — for current behavior, see `docs/runbook.md`

This guide covers the full OAuth identity fix and environment variable refactor arc. If you last worked on the codebase before these changes shipped, read this to understand what changed.

---

## What Was Removed

### AUTH_USER_ID identity chain (KZO-98, KZO-99)

The entire `AUTH_USER_ID` → `NEXT_PUBLIC_AUTH_USER_ID` → `x-authenticated-user-id` header chain was removed. This chain was the root cause of the Google login bug: the header-based identity overrode the session cookie, so after OAuth login, the API still used the hardcoded `user-1` identity.

| Removed item | Where it was |
|-------------|-------------|
| `AUTH_USER_ID` env var | Docker schemas, compose build args, deploy.sh validation |
| `NEXT_PUBLIC_AUTH_USER_ID` | Dockerfile ARG/ENV, `api.ts` |
| `NEXT_PUBLIC_DEV_USER_ID` | `api.ts` (dead code, never set anywhere) |
| `NEXT_PUBLIC_API_PORT` | `api.ts` (dead code, never set anywhere) |
| `x-authenticated-user-id` header trust | `resolveUserId()` in oauth mode |

**What replaced it:** Session cookies are now the **sole identity source** in oauth mode. `resolveUserId()` reads the HMAC-signed session cookie. No headers, no env vars in the identity path.

### Five env-setup targets (KZO-103)

| Removed target | Output path | Why removed |
|----------------|-------------|-------------|
| `root:dev` | `.env.dev` | Unused — bare metal dev uses `.env.local` only |
| `root:prod` | `.env.prod` | Unused — production uses Docker env files |
| `web:local` | `apps/web/.env.local` | Next.js reads from root `.env.local`; separate web file redundant |
| `web:dev` | `apps/web/.env.dev` | Same reason |
| `web:prod` | `apps/web/.env.prod` | Same reason |

### Three example files (KZO-103)

| Removed file | Replaced by |
|-------------|------------|
| `apps/web/.env.example` | Removed in KZO-101 (web vars folded into root schema) |
| `infra/docker/.env.dev.example` | Unified `.env.example` at repo root |
| `infra/docker/.env.prod.example` | Unified `.env.example` at repo root |

### Exports removed

| Export | File | Replaced by |
|--------|------|------------|
| `webEnvGroups` | `libs/config/src/env-metadata.ts` | `rootLocalGroups` (includes web keys) |
| `dockerDevSchema` | `libs/config/src/env-docker.ts` | `dockerCloudSchema` (unified, KZO-102) |
| `dockerProdSchema` | `libs/config/src/env-docker.ts` | `dockerCloudSchema` (unified, KZO-102) |
| `dockerDevGroups` | `libs/config/src/env-metadata.ts` | `dockerCloudGroups` (unified, KZO-102) |
| `dockerProdGroups` | `libs/config/src/env-metadata.ts` | `dockerCloudGroups` (unified, KZO-102) |

---

## What Was Added

### dev_bypass SSR fallback (KZO-98)

`auth.ts` now returns `{ userId: "user-1" }` as a default in dev_bypass mode when no cookie is set. This matches the API's `resolveUserId()` fallback. Developer runs `dev:local:bypass:mem`, opens browser, sees dashboard — no env vars or cookies needed.

### Unified env schemas (KZO-101, KZO-102)

| New export | File | Purpose |
|-----------|------|---------|
| `webEnvSchema` (via `pick().extend()`) | `env-schema.ts` | Web-side env, derived from `envSchema`. Edge Runtime safe. |
| `dockerCloudSchema` | `env-docker.ts` | Unified dev + prod Docker schema. Replaces separate dev/prod schemas. |
| `DEPLOY_ENV` field | `dockerCloudSchema` | Cloud tier: `"dev"` or `"production"`. Docker-only. |
| `validateCookieDomainRequired()` | `env-docker.ts` | Throws when cross-subdomain deploy lacks `COOKIE_DOMAIN`. |
| `validateEnvConstraints()` | `env.ts` | Renamed from `validatePortConflicts()`. Added injectable params. |

### rootLocalSchema + rootLocalGroups (KZO-103)

| New export | File | Purpose |
|-----------|------|---------|
| `rootLocalSchema` | `env-schema.ts` | `envSchema.extend({ NEXT_PUBLIC_AUTH_MODE, NEXT_PUBLIC_API_BASE_URL })`. Used only by the `root:local` env-setup target. `envSchema` itself is unchanged. |
| `rootLocalGroups` | `env-metadata.ts` | `[...envGroups, { label: "Web app (Next.js)", keys: [...] }]`. Ordering config for the generator. |

### footerNotes on generated Docker files (KZO-103)

Generated `infra/docker/.env.dev` and `.env.prod` now include plain-text derivation notes at the end:

```
## Compose-computed — set by docker-compose environment: block, not this file
## To change GOOGLE_REDIRECT_URI  → update PUBLIC_DOMAIN_API
## To change APP_BASE_URL         → update PUBLIC_DOMAIN_WEB
## To change DB_URL               → update POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
## To change REDIS_URL            → update REDIS_PASSWORD
## To change ALLOWED_ORIGINS      → update PUBLIC_DOMAIN_WEB
```

### dev.sh safety net (KZO-103)

`scripts/dev.sh` now derives `NEXT_PUBLIC_*` from root vars if not explicitly set:

```bash
export NEXT_PUBLIC_AUTH_MODE="${NEXT_PUBLIC_AUTH_MODE:-${AUTH_MODE:-dev_bypass}}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:${API_PORT:-4000}}"
```

This prevents split-brain auth (API runs oauth but web defaults to dev_bypass).

### Unified `.env.example` (KZO-103)

Single `.env.example` at repo root documents ALL variables across all deployment contexts with `[context]` annotations (e.g., `[Docker cloud only]`, `[oauth only]`, `[postgres only]`).

---

## What's Unchanged

| Aspect | Still works the same way |
|--------|------------------------|
| `deploy.sh` | Same usage: `bash infra/scripts/deploy.sh -e dev` / `-e production` |
| Docker compose files | Same files, same interpolation, same service names |
| `envSchema` | Unchanged — no web concerns leaked in |
| `webEnvSchema` | Unchanged — still `envSchema.pick().extend()`, still Edge Runtime safe |
| `env-web.ts` / `WebEnv` | Unchanged — runtime parse for Next.js |
| `env.ts` / `Env` | Unchanged — runtime parse for API |
| OAuth flow | Same: Google consent → callback → HMAC session cookie |
| E2E test structure | Same suites: bypass (`specs/`) and oauth (`specs-oauth/`) |
| `docker:local`, `docker:dev`, `docker:prod` targets | Still exist, same output paths |
| `root:local` target | Still exists, same output path (`.env.local`), but now includes `NEXT_PUBLIC_*` vars |

---

## Before/After Comparison

### Env-setup targets

| Before (9 targets) | After (4 targets) |
|--------------------|--------------------|
| `root:local` → `.env.local` (envSchema) | `root:local` → `.env.local` (**rootLocalSchema** — includes NEXT_PUBLIC_*) |
| `root:dev` → `.env.dev` | Removed |
| `root:prod` → `.env.prod` | Removed |
| `docker:dev` → `infra/docker/.env.dev` | `docker:dev` → `infra/docker/.env.dev` (+ footerNotes) |
| `docker:local` → `infra/docker/.env.local` | `docker:local` → `infra/docker/.env.local` (unchanged) |
| `docker:prod` → `infra/docker/.env.prod` | `docker:prod` → `infra/docker/.env.prod` (+ footerNotes) |
| `web:local` → `apps/web/.env.local` | Removed |
| `web:dev` → `apps/web/.env.dev` | Removed |
| `web:prod` → `apps/web/.env.prod` | Removed |

### Example files

| Before (4 files) | After (1 file) |
|-------------------|----|
| `.env.example` (root, 43 lines) | `.env.example` (root, unified, all vars with `[context]` annotations) |
| `apps/web/.env.example` | Deleted (KZO-101) |
| `infra/docker/.env.dev.example` | Deleted (KZO-103) |
| `infra/docker/.env.prod.example` | Deleted (KZO-103) |

### Auth identity resolution (oauth mode)

| Before | After |
|--------|-------|
| `NEXT_PUBLIC_AUTH_USER_ID` baked into Next.js bundle | Removed — no env-based identity |
| `getAuthHeaders()` sends `x-authenticated-user-id` header | `getAuthHeaders()` sends empty headers (API uses session cookie) |
| `resolveUserId()` checks header first, then cookie | `resolveUserId()` checks session cookie only (sole identity source) |
| `deploy.sh` requires `AUTH_USER_ID` for oauth | `deploy.sh` **forbids** `AUTH_USER_ID` for oauth |

### Validation rules

| Before | After |
|--------|-------|
| `validatePortConflicts()` — no params, reads singleton | `validateEnvConstraints()` — injectable params, accepts input |
| dev_bypass allowed only in `NODE_ENV=development` | dev_bypass blocked only when `NODE_ENV=production` (allows `test` for E2E CI) |
| No `COOKIE_DOMAIN` validation | `validateCookieDomainRequired()` — throws when cross-subdomain without `COOKIE_DOMAIN` |
| `COOKIE_DOMAIN` optional with default | `COOKIE_DOMAIN` required in `dockerCloudSchema` (no default) |

### Post-worktree hook

| Before | After |
|--------|-------|
| `--target root:local,web:local,docker:local` | `--target root:local,docker:local` |

---

## Migration Steps

### If you have existing env files

Your existing `infra/docker/.env.dev`, `.env.prod`, `.env.local`, and root `.env.local` still work. No migration required for running services.

**However**, regenerating is recommended to pick up the new `NEXT_PUBLIC_*` vars in root `.env.local` and footer notes in Docker files:

```bash
# Regenerate root local (now includes NEXT_PUBLIC_* vars)
npm run env:setup -- --target root:local

# Regenerate Docker files (now includes footer notes)
npm run env:setup -- --target docker:dev
npm run env:setup -- --target docker:prod
```

### If you have `AUTH_USER_ID` in your env files

Remove it. It's no longer used and `deploy.sh` will error if it's set with `AUTH_MODE=oauth`:

```bash
# Check if AUTH_USER_ID is set in any env file
grep -r "AUTH_USER_ID" infra/docker/.env.* .env.local

# Remove any lines containing AUTH_USER_ID
```

### If you have `apps/web/.env.local`

It's no longer generated by the env-setup tool. You can delete it — Next.js reads `NEXT_PUBLIC_*` from the root `.env.local` now (via `dev.sh` sourcing).

```bash
rm -f apps/web/.env.local
```

### If you reference the old example files

They no longer exist. Use the unified `.env.example` at the repo root as the reference for all variables. It has `[context]` annotations to indicate which vars apply to which deployment context.

### If you create new worktrees

The post-worktree hook now runs `--target root:local,docker:local` (no `web:local`). New worktrees automatically get the correct env files.

---

## Tickets in This Arc

| Ticket | Title | PR | Status |
|--------|-------|-----|--------|
| KZO-98 | Wire middleware + dev_bypass SSR fallback | Merged | Complete |
| KZO-99 | Remove AUTH_USER_ID pipeline | Merged (same PR as KZO-98) | Complete |
| KZO-100 | Fix Docker auth config gaps | Merged | Complete |
| KZO-101 | Unify env schemas — fold webEnvSchema + add DEPLOY_ENV | Merged | Complete |
| KZO-102 | Merge Docker schemas + add COOKIE_DOMAIN validation | Merged (same PR as KZO-101) | Complete |
| KZO-103 | Create unified .env.example + reduce env-setup targets | This PR | Complete |
