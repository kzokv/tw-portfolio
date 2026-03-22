# Implementation TODO — KZO-103: Unified .env.example + Reduce env-setup Targets

> Consolidated from grill-me session on 2026-03-22.
> Scope: unified .env.example, target reduction (9 → 4), generator footer notes, NEXT_PUBLIC_* in root:local.
> Linear ticket: KZO-103
> Branch: `kzo-103`
> PR: single PR, single commit.
> **Status: COMPLETE**

---

## Grill Session Decisions

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | NEXT_PUBLIC_* after web target removal | Named `rootLocalSchema = envSchema.extend(...)` in `env-schema.ts` + `rootLocalGroups` in `env-metadata.ts`. Decouples generation schema from web runtime schema. |
| 2 | dev.sh safety net | Add `NEXT_PUBLIC_AUTH_MODE="${NEXT_PUBLIC_AUTH_MODE:-$AUTH_MODE}"` derivation in dev.sh to prevent split-brain auth. |
| 3 | Unified .env.example | Hand-authored, single source of truth. Sectioned with `[context]` annotations. Compose-computed vars as comment block showing `${VAR}` derivation formulas. |
| 4 | Compose-computed vars in generated Docker files | Plain-text derivation notes (no `${VAR}` syntax). `footerNotes: string[]` on `TargetConfig`, generator appends at end. |
| 5 | Target reduction | Clean removal of 5 targets. Update types.ts, post-worktree hook, env-setup.ts comments. |
| 6 | env-metadata.ts cleanup | Remove `webEnvGroups`. Add `rootLocalGroups`. |
| 7 | Commit structure | Single commit, single PR. |

---

## 1. Create unified `.env.example`

- [x] Replace root `.env.example` with unified version containing ALL vars from all schemas
- [x] Section structure with `[context]` annotations:
  ```
  ## Environment & modes
  ## Application ports
  ## Database / Redis URLs                    [postgres only]
  ## Market data providers
  ## Security / Tuning
  ## Google OAuth                             [oauth only]
  ## Web app (Next.js)
  ## Docker: public domains                   [Docker cloud only]
  ## Docker: infrastructure credentials       [Docker only]
  ## Docker: Cloudflare tunnel                [Docker cloud only]
  ## Docker: application overrides            [Docker only]
  ## Docker: state paths                      [Docker cloud only]
  ## Docker: compose-computed                 [Docker cloud only — do not set manually]
  ```
- [x] Compose-computed vars documented as comments with `${VAR}` formulas:
  ```bash
  ## Docker: compose-computed [Docker cloud only — computed by docker-compose, do not set manually]
  # GOOGLE_REDIRECT_URI=https://${PUBLIC_DOMAIN_API}/auth/google/callback
  # APP_BASE_URL=https://${PUBLIC_DOMAIN_WEB}
  # DB_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
  # REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
  # ALLOWED_ORIGINS=https://${PUBLIC_DOMAIN_WEB}
  ```
- [x] Include `NEXT_PUBLIC_AUTH_MODE` and `NEXT_PUBLIC_API_BASE_URL` under "Web app (Next.js)" section
- [x] Include `DEPLOY_ENV` under Docker sections
- [x] Preserve cookie config pair explanation from existing docker examples

---

## 2. Delete separate Docker example files

- [x] Delete `infra/docker/.env.dev.example`
- [x] Delete `infra/docker/.env.prod.example`

---

## 3. Add `rootLocalSchema` + `rootLocalGroups`

### 3.1 `libs/config/src/env-schema.ts`
- [x] Add named schema:
  ```typescript
  /** Generation schema for root:local target. Includes NEXT_PUBLIC_* for Next.js. */
  export const rootLocalSchema = envSchema.extend({
    NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
    NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
  });
  ```
- [x] Verify: `envSchema` is unchanged (no web concerns leaked)
- [x] Verify: `webEnvSchema` is unchanged (still uses `pick().extend()`)

### 3.2 `libs/config/src/env-metadata.ts`
- [x] Add `rootLocalGroups`:
  ```typescript
  export const rootLocalGroups: EnvGroup[] = [
    ...envGroups,
    { label: "Web app (Next.js)", keys: ["NEXT_PUBLIC_AUTH_MODE", "NEXT_PUBLIC_API_BASE_URL"] },
  ];
  ```
- [x] Remove `webEnvGroups` export

---

## 4. Add `footerNotes` to generator

### 4.1 `scripts/env-setup/types.ts`
- [x] Add optional `footerNotes` to `TargetConfig`:
  ```typescript
  export interface TargetConfig {
    id: TargetId;
    label: string;
    targetPath: string;
    schema: z.ZodObject<any>;
    groups: EnvGroup[];
    footerNotes?: string[];
  }
  ```
- [x] Update `TargetId` union — remove `root:dev`, `root:prod`, `web:local`, `web:dev`, `web:prod`

### 4.2 `scripts/env-setup/generator.ts`
- [x] After the ungrouped "Other" section, append footer notes:
  ```typescript
  // Footer notes (compose-computed derivation hints, etc.)
  if (target.footerNotes?.length) {
    for (const note of target.footerNotes) {
      lines.push(`## ${note}`);
    }
    lines.push("");
  }
  ```

---

## 5. Update `targets.ts`

### 5.1 Remove 5 targets
- [x] Remove `root:dev` target
- [x] Remove `root:prod` target
- [x] Remove `web:local` target
- [x] Remove `web:dev` target
- [x] Remove `web:prod` target

### 5.2 Update `root:local` target
- [x] Change schema from `envSchema` to `rootLocalSchema`
- [x] Change groups from `envGroups` to `rootLocalGroups`
- [x] Update imports accordingly

### 5.3 Add `footerNotes` to Docker cloud targets
- [x] Add to `docker:dev` and `docker:prod`:
  ```typescript
  footerNotes: [
    "Compose-computed — set by docker-compose environment: block, not this file",
    "To change GOOGLE_REDIRECT_URI  → update PUBLIC_DOMAIN_API",
    "To change APP_BASE_URL         → update PUBLIC_DOMAIN_WEB",
    "To change DB_URL               → update POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB",
    "To change REDIS_URL            → update REDIS_PASSWORD",
    "To change ALLOWED_ORIGINS      → update PUBLIC_DOMAIN_WEB",
  ],
  ```

### 5.4 Update imports
- [x] Remove `webEnvSchema` import (no longer needed)
- [x] Remove `webEnvGroups` import
- [x] Add `rootLocalSchema` import from `env-schema.js`
- [x] Add `rootLocalGroups` import from `env-metadata.js`

---

## 6. Add `dev.sh` derivation safety net

- [x] After the `set -a / . ./.env.local / set +a` block, add:
  ```bash
  # Derive NEXT_PUBLIC_* from root vars if not explicitly set (prevents split-brain auth)
  export NEXT_PUBLIC_AUTH_MODE="${NEXT_PUBLIC_AUTH_MODE:-${AUTH_MODE:-dev_bypass}}"
  export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:${API_PORT:-4000}}"
  ```

---

## 7. Update post-worktree hook

- [x] Change `.hooks/post-worktree-create.sh` line 9:
  ```bash
  # Before:
  npx tsx scripts/env-setup.ts --target root:local,web:local,docker:local --non-interactive --source "$MAIN_ROOT"
  # After:
  npx tsx scripts/env-setup.ts --target root:local,docker:local --non-interactive --source "$MAIN_ROOT"
  ```

---

## 8. Update `env-setup.ts` usage comments

- [x] Update header comments (lines 7-9):
  ```typescript
  *   npm run env:setup -- --target root:local
  *   npm run env:setup -- --target root:local,docker:local --non-interactive
  *   npm run env:setup -- --target root:local,docker:local --non-interactive --source .
  ```

---

## 9. Verify

- [x] Build passes (`npm run build`)
- [x] Lint passes (`npm run lint`)
- [x] Typecheck passes
- [x] `npm run env:setup -- --target root:local --non-interactive` generates `.env.local` with `NEXT_PUBLIC_*` vars
- [x] `npm run env:setup -- --target docker:dev --non-interactive --source infra/docker/.env.dev` generates file with footer notes
- [x] All unit tests pass
- [x] All integration tests pass
- [x] E2E bypass suite passes
- [x] E2E oauth suite passes

---

## Files In Scope

| File | Action |
|------|--------|
| `.env.example` | Rewrite — unified with all vars and `[context]` annotations |
| `infra/docker/.env.dev.example` | Delete |
| `infra/docker/.env.prod.example` | Delete |
| `libs/config/src/env-schema.ts` | Add `rootLocalSchema` |
| `libs/config/src/env-metadata.ts` | Add `rootLocalGroups`, remove `webEnvGroups` |
| `scripts/env-setup/types.ts` | Add `footerNotes`, trim `TargetId` union |
| `scripts/env-setup/generator.ts` | Append footer notes after groups |
| `scripts/env-setup/targets.ts` | Remove 5 targets, update root:local schema/groups, add footerNotes to docker cloud |
| `scripts/env-setup.ts` | Update usage comments |
| `scripts/dev.sh` | Add NEXT_PUBLIC_* derivation safety net |
| `.hooks/post-worktree-create.sh` | Remove `web:local` from `--target` |

---

## Out of Scope (tracked for future PRs)

| Item | Tracked In |
|------|-----------|
| Dev experience (npm scripts, dev.sh refactor, help-printers) | KZO-104 |
| Docker utility scripts (dev-docker.sh, cleanup) | KZO-105 |
| E2E script renames + test infrastructure | KZO-106 |
| Demo user feature (DEMO_MODE_ENABLED, /auth/demo/start) | Doc 03 Section 2 |
| e2eEnvSchema (MOCK_OAUTH_PORT, HOST, GOOGLE_OAUTH_REFRESH_TOKEN) | Future |

---

## Key Rules (from .claude/rules/)

When implementing, respect these guardrails:

1. **Do NOT modify `app.ts` or `registerRoutes.ts` to accommodate test setup** — if tests fail due to auth mode, use `vi.mock("@tw-portfolio/config")` at the test-file level. See `.claude/rules/vitest-auth-mode-override.md`.
2. **API route handlers use `getSession()` + manual 401**, never `requireSession()`. See `.claude/rules/api-route-session-guard.md`.
3. **If a fix requires production code changes for test-only reasons**, send `[QUESTION]` to the Architect. See `.claude/rules/fixer-scope-guardrail.md`.
