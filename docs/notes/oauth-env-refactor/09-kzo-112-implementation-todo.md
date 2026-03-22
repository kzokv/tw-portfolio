# Implementation TODO — KZO-112: Docker Local Deployment Hardening

> Consolidated from grill-me session on 2026-03-22.
> Scope: env defaults, error detection, preflight healthcheck, Docker script variants, cleanup UX, docs.
> Linear ticket: KZO-112
> Branch: `kzo-112`
> PR: single PR, single commit.

---

## Grill Session Decisions

| # | Question | Resolution |
|---|----------|-----------|
| Q1 | NODE_ENV default for Docker local | `test` — best behavior matrix (no Secure cookie, relaxed CORS, `/__e2e/oauth-session` available, `/__e2e/reset` blocked). Custom values risk unpredictable library fallback. |
| Q2 | NEXT_PUBLIC_AUTH_MODE runtime env in compose | Drop — redundant with existing build arg at compose line 140. Dockerfile converts `ARG → ENV`. |
| Q3 | SERVER_API_BASE_URL in dockerLocalSchema | No — compose-internal (hardcoded container-network address). env-setup should not prompt for it. |
| Q4 | NEXT_PUBLIC_AUTH_MODE in dockerLocalSchema | No — derived from `AUTH_MODE` via compose `build: args:` substitution. `AUTH_MODE` is already in the schema. |
| Q5 | app.appBaseUrl existence | Confirmed — set at `app.ts:64` as `options.appBaseUrl ?? Env.APP_BASE_URL ?? "http://localhost:3000"`. |
| Q6 | Login page preflight approach | Option B — extract `<SignInButton>` client component. Keep login page as server component. |
| Q7 | insecure_transport error page audience | Developer-facing. Technical detail is appropriate. |
| Q8 | Docker script variants | `dev:docker:bypass:pg` + `dev:docker:oauth:pg`. Drop `dev:docker` — no alias, clean break. No `mem` variants for Docker (postgres is containerized, zero setup friction). |
| Q9 | Docker cleanup selective targets | `--containers` and `--images` flags. Interactive mode prompts user to choose. `--yes` defaults to both (backward compatible). |
| Q10 | SSH tunnel IP in docs/errors | Use `192.168.64.1` as example only. Tell user to replace with their Docker host IP. |
| Q11 | NODE_ENV docs wording | Don't say "cannot be X" — document actual behavior for each value so user makes informed choice. |
| Q12 | help.sh update | Yes — replace `dev:docker` with new variant names. |
| Q13 | dev-docker.sh banner name | Accept `$1` as banner name (same pattern as `dev.sh`). |
| Q14 | Tests for DX items | No — scope items 3–5 are DX improvement, not production logic. |
| Q15 | Implementation TODO note | Yes — `09-kzo-112-implementation-todo.md` following series format. |

---

## 1. Copy kzo-104 unstaged fixes

### 1.1 `libs/config/src/env-schema.ts`
- [ ] Add `SERVER_API_BASE_URL: z.string().url().optional()` to `webEnvSchema`
- [ ] Add JSDoc: "Server-side API base URL. In Docker, route handlers fetch via container network (e.g. http://twp-local-api:4000) instead of the host-published port."

### 1.2 `apps/web/app/api/profile/route.ts`
- [ ] Change `API_BASE` from `process.env.NEXT_PUBLIC_API_BASE_URL || ...` to `WebEnv.SERVER_API_BASE_URL ?? WebEnv.NEXT_PUBLIC_API_BASE_URL`
- [ ] Add comment: "In Docker, server-side route handlers fetch via container network (SERVER_API_BASE_URL), not the host-published port. Falls back to NEXT_PUBLIC_API_BASE_URL for bare-metal dev."

### 1.3 `infra/docker/docker-compose.local.yml`
- [ ] Change `NODE_ENV: production` to `NODE_ENV: ${NODE_ENV:-test}` for **both** api and web services
- [ ] Add comment above NODE_ENV: `# 'test' avoids Secure cookie flag (production) and port validation mismatch (development)`
- [ ] Add `SERVER_API_BASE_URL: http://twp-local-api:4000` to web service environment
- [ ] Add comment: `# Server-side API base URL for route handlers running inside the container network.`
- [ ] **Do NOT** add `NEXT_PUBLIC_AUTH_MODE` to web service `environment:` — already a build arg at line 140

---

## 2. `dockerLocalSchema` default change

### 2.1 `libs/config/src/env-docker.ts`
- [ ] Change `NODE_ENV` default from `"production"` to `"test"` (line 50)
- [ ] Update comment: `# 'test' is recommended for local Docker — see runbook for NODE_ENV behavior matrix`

---

## 3. OAuth callback — insecure_transport detection

### 3.1 `apps/api/src/routes/registerRoutes.ts`
- [ ] After `buildCookieAttrs()` call (~line 503), before `reply.header("set-cookie", ...)`:
  ```typescript
  const isSecureCookie = attrs.includes("Secure");
  const isHttpTransport = app.appBaseUrl?.startsWith("http://");
  if (isSecureCookie && isHttpTransport) {
    return errorRedirect("insecure_transport");
  }
  ```
- [ ] Uses existing `errorRedirect` helper (defined at ~line 459)

---

## 4. `/auth/error` page — `insecure_transport` reason

### 4.1 `apps/web/app/auth/error/page.tsx`
- [ ] Add to `REASON_MESSAGES`:
  ```typescript
  insecure_transport: {
    title: "Session cookie rejected",
    description:
      "Your browser rejected the session cookie because you're accessing the app over HTTP, but the cookie requires HTTPS (Secure flag). To fix this, set NODE_ENV=test in your Docker env file (infra/docker/.env.local) and rebuild.",
    linkText: "Back to login",
  },
  ```

---

## 5. Login page — preflight healthcheck

### 5.1 Create `apps/web/components/SignInButton.tsx`
- [ ] `"use client"` component
- [ ] Props: `href: string`, `className?: string`
- [ ] State: `error: string | null`, `loading: boolean`
- [ ] On click:
  - Set `loading = true`
  - `fetch(apiBaseUrl + "/health/live", { signal: AbortSignal.timeout(3000) })`
  - Success → `window.location.href = href`
  - Failure → set error: "Cannot reach the API server. If your API runs in a Docker container, create an SSH tunnel forwarding the API port (e.g. `-L 4300:192.168.64.1:4300` — replace the IP with your Docker host IP)."
  - Finally → set `loading = false`
- [ ] Render: button with existing styles + inline error message below when set

### 5.2 Update `apps/web/app/login/page.tsx`
- [ ] Import `SignInButton` from `../../components/SignInButton`
- [ ] Replace `<a href={signInHref} ...>Sign in with Google</a>` with `<SignInButton href={signInHref} className={...} />`
- [ ] Keep page as async server component (no `"use client"`)

---

## 6. Docker script variants

### 6.1 Update `package.json`
- [ ] Replace `"dev:docker": "bash scripts/dev-docker.sh"` with:
  ```json
  "dev:docker:bypass:pg": "AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=postgres bash scripts/dev-docker.sh dev:docker:bypass:pg",
  "dev:docker:oauth:pg": "AUTH_MODE=oauth PERSISTENCE_BACKEND=postgres bash scripts/dev-docker.sh dev:docker:oauth:pg"
  ```
- [ ] Remove `"dev:docker"` entirely

### 6.2 Update `scripts/dev-docker.sh`
- [ ] Accept `$1` as banner script name (default: `dev:docker`)
- [ ] Fix env var precedence — save CLI values before sourcing `.env.local`:
  ```bash
  CLI_AUTH_MODE="${AUTH_MODE:-}"
  CLI_PERSISTENCE_BACKEND="${PERSISTENCE_BACKEND:-}"

  if [[ -f "infra/docker/.env.local" ]]; then
    set -a
    . "infra/docker/.env.local"
    set +a
  fi

  # CLI overrides take precedence over env file
  export AUTH_MODE="${CLI_AUTH_MODE:-${AUTH_MODE:-oauth}}"
  export PERSISTENCE_BACKEND="${CLI_PERSISTENCE_BACKEND:-${PERSISTENCE_BACKEND:-postgres}}"
  ```
- [ ] Pass `$1` to `print_banner`:
  ```bash
  print_banner "${1:-dev:docker}" docker
  ```

### 6.3 Update `scripts/help.sh` dev section
- [ ] Replace `dev:docker` line with:
  ```
    dev:docker:bypass:pg       Docker stack, bypass auth, Postgres
    dev:docker:oauth:pg        Docker stack, Google OAuth, Postgres (closest to prod)
    dev:docker:* --migrate     Include DB migrations
  ```
- [ ] Remove Docker utility sub-listings if they exist (cleanup/validate stay unchanged)

---

## 7. Documentation

### 7.1 `docs/runbook.md`
- [ ] Add "Local Docker Deployment" troubleshooting section with:
  - SSH tunnel: if API runs in Docker container, forward API port to Docker host IP (e.g. `192.168.64.1` — varies by environment)
  - `SESSION_COOKIE_NAME`: must not use `__Host-` prefix over HTTP
  - NODE_ENV behavior matrix:
    - `production` → `Secure` cookie flag set, browser silently drops cookie over HTTP
    - `development` → port validation rejects mismatched container/host ports (4000 vs 4300)
    - `test` (recommended) → no `Secure` flag, relaxed port validation, `/__e2e/oauth-session` available
  - `NEXT_PUBLIC_AUTH_MODE`: baked at build time — runtime env vars don't override client-side JS
  - `SERVER_API_BASE_URL`: for server-side route handlers inside Docker network

### 7.2 `.env.example`
- [ ] Add `[Docker local]` annotations:
  - `NODE_ENV`: note `test` is recommended for local Docker (see runbook for behavior matrix)
  - `SESSION_COOKIE_NAME`: warn against `__Host-` prefix over HTTP
  - `SERVER_API_BASE_URL`: note this is compose-internal for Docker container-network routing

---

## 8. Docker cleanup — selective targets

### 8.1 `scripts/docker-cleanup.sh`
- [ ] Add `CLEAN_CONTAINERS=0` and `CLEAN_IMAGES=0` state vars
- [ ] Add `--containers` and `--images` flag parsing
- [ ] If neither `--containers` nor `--images` set and not `--yes`:
  - After `show_targets`, prompt:
    ```
    What would you like to clean?
      [c] Stopped containers only
      [i] Dangling images only
      [b] Both
      [n] Cancel
    >
    ```
  - Map selection to `CLEAN_CONTAINERS` / `CLEAN_IMAGES`
- [ ] If `--yes` without `--containers`/`--images` → both (backward compatible)
- [ ] `show_targets` respects selection (only show relevant section)
- [ ] `cleanup_docker` respects selection (only prune selected)
- [ ] Update `usage()` help text with new flags
- [ ] Update confirmation prompt to reflect selection

---

## Files In Scope

| File | Action |
|------|--------|
| `libs/config/src/env-schema.ts` | Add `SERVER_API_BASE_URL` to `webEnvSchema` |
| `libs/config/src/env-docker.ts` | Change `NODE_ENV` default to `"test"` |
| `apps/web/app/api/profile/route.ts` | Use `WebEnv.SERVER_API_BASE_URL` |
| `apps/api/src/routes/registerRoutes.ts` | Add insecure_transport detection |
| `apps/web/app/auth/error/page.tsx` | Add `insecure_transport` reason |
| `apps/web/components/SignInButton.tsx` | Create — preflight healthcheck client component |
| `apps/web/app/login/page.tsx` | Use `<SignInButton>` component |
| `infra/docker/docker-compose.local.yml` | NODE_ENV, SERVER_API_BASE_URL |
| `package.json` | Replace `dev:docker` with two variants |
| `scripts/dev-docker.sh` | Banner name `$1`, env var precedence fix |
| `scripts/help.sh` | Update dev section Docker listings |
| `scripts/docker-cleanup.sh` | Selective target support |
| `docs/runbook.md` | Add Docker local troubleshooting section |
| `.env.example` | Add `[Docker local]` annotations |
| `docs/notes/oauth-env-refactor/09-kzo-112-implementation-todo.md` | This file |

---

## Out of Scope

| Item | Tracked In |
|------|-----------|
| Demo user feature (DEMO_MODE_ENABLED, /auth/demo/start) | KZO-107 |
| Demo user frontend (login page "Try it?" button) | KZO-108 |
| Add E2E jobs to CI workflow | KZO-109 |
| Add validation unit tests + auth regression tests | KZO-110 |
| Tests for insecure_transport / preflight / error page | Confirmed out of scope (DX improvement) |
| NEXT_PUBLIC_AUTH_MODE rebuild cost warning | Deferred (over-engineering for dev tool) |

---

## Key Rules (from .claude/rules/)

When implementing, respect these guardrails:

1. **Do NOT modify `app.ts` or `registerRoutes.ts` to accommodate test setup** — if tests fail due to auth mode, use `vi.mock("@tw-portfolio/config")` at the test-file level. See `.claude/rules/vitest-auth-mode-override.md`.
2. **API route handlers use `getSession()` + manual 401**, never `requireSession()`. See `.claude/rules/api-route-session-guard.md`.
3. **If a fix requires production code changes for test-only reasons**, send `[QUESTION]` to the Architect. See `.claude/rules/fixer-scope-guardrail.md`.

**Note:** Scope item 3 (insecure_transport detection) modifies `registerRoutes.ts` — this is a **production error detection feature**, not a test setup change, so the rule does not apply.
