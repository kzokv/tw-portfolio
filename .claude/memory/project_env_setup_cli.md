---
name: env-setup CLI architecture
description: Interactive env file generator built in this project — structure, targets, design constraints
type: project
---

`scripts/env-setup.ts` is the entry point, run via `npm run env:setup` (uses `tsx` — no compile step needed).

**Why:** Replaced blind `cp .env.example .env` in onboard.sh. Generates env files from Zod schemas with grouping metadata, sensitive key masking, auto-generated secrets, and merge strategies.

**How to apply:** When touching env file management, config loading, or onboarding flow — check this system first before adding new ad-hoc env handling.

## File layout

```
scripts/
  env-setup.ts              # entry point: CLI arg parsing, orchestration
  env-setup/
    types.ts                # TargetId, TargetConfig, MergeStrategy, ResolvedValue
    targets.ts              # 8-target registry (root:local, docker:dev, web:local, etc.)
    parser.ts               # parseDotEnvLine + parseDotEnvFile
    source-reader.ts        # --source flag: reads values from existing env files
    generator.ts            # generates .env file content from schema + metadata
    prompts.ts              # @inquirer/prompts wrappers + Zod schema introspection
```

## 8 targets

| id | targetPath |
|---|---|
| root:local | .env.local |
| root:dev | .env.dev |
| root:prod | .env.prod |
| docker:dev | infra/docker/.env.dev |
| docker:prod | infra/docker/.env.prod |
| web:local | apps/web/.env.local |
| web:dev | apps/web/.env.dev |
| web:prod | apps/web/.env.prod |

## Lib modules added to `libs/config/src/`

- `env-schema.ts` — side-effect-free: exports `envSchema`, `parseDotEnvLine`, `EnvConfig`. **Critical**: importing this does NOT trigger `loadDotEnv()`. Required for the script to import without side effects.
- `env-metadata.ts` — `EnvGroup`, `envGroups`, `dockerDevGroups`, `dockerProdGroups`, `webEnvGroups`, `sensitiveKeys`, `autoGenerateKeys`
- `env-docker.ts` — `dockerDevSchema`, `dockerProdSchema`
- `env-web.ts` — `webEnvSchema`

`env.ts` now imports from `env-schema.ts` and re-exports `EnvConfig` and `envSchema`.

## CLI flags

- `--target root:local,web:local` — comma-separated target IDs
- `--non-interactive` — accept all defaults, no prompts (requires `--target`)
- `--source <path>` — copy values from existing env files at that root

## `.env` → `.env.local` rename (Step 0)

Root local dev config was renamed from `.env` to `.env.local`. Updated in:
- `libs/config/src/env.ts` (loadDotEnv walk)
- `libs/config/src/test.ts` (loadDotEnvSync)
- `scripts/dev.sh`, `scripts/kill-next.sh`
- `apps/web/package.json` (3 script entries)
- `.hooks/post-worktree-create.sh`
- Comments in vitest configs, playwright.oauth.config.ts, docs/runbook.md

`.gitignore` already had `.env.local` on line 4 — no change needed.

## Integration points

- `scripts/onboard.sh` step 5: runs `env-setup.ts --target root:local` interactively, or `--non-interactive` in CI
- `.hooks/post-worktree-create.sh`: runs `env-setup.ts --target root:local,web:local --non-interactive --source "$MAIN_ROOT"`
- `source-reader.ts` for `root:local` also checks `<source>/.env` as backward-compat fallback
