---
name: env-setup CLI architecture
description: Interactive env file generator — 4 targets (root:local, docker:dev, docker:local, docker:prod), Zod schemas, CLI flags
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
    targets.ts              # 4-target registry
    parser.ts               # parseDotEnvLine + parseDotEnvFile
    source-reader.ts        # --source flag: reads values from existing env files
    generator.ts            # generates .env file content from schema + metadata
    prompts.ts              # @inquirer/prompts wrappers + Zod schema introspection
```

## 4 targets (post-KZO-103 consolidation)

| id | targetPath |
|---|---|
| root:local | .env.local |
| docker:dev | infra/docker/.env.dev |
| docker:local | infra/docker/.env.local |
| docker:prod | infra/docker/.env.prod |

## Lib modules in `libs/config/src/`

- `env-schema.ts` — side-effect-free: exports `envSchema`, `rootLocalSchema`, `parseDotEnvLine`, `EnvConfig`. **Critical**: importing this does NOT trigger `loadDotEnv()`.
- `env-metadata.ts` — `EnvGroup`, `rootLocalGroups`, `dockerCloudGroups`, `dockerLocalGroups`, `sensitiveKeys`, `autoGenerateKeys`
- `env-docker.ts` — `dockerCloudSchema`, `dockerLocalSchema`

`env.ts` now imports from `env-schema.ts` and re-exports `EnvConfig` and `envSchema`.

## CLI flags

- `--target root:local,docker:local` — comma-separated target IDs
- `--non-interactive` — accept all defaults, no prompts (requires `--target`)
- `--source <path>` — copy values from existing env files at that root

## Integration points

- `scripts/onboard.sh` step 5: runs `env-setup.ts --target root:local` interactively, or `--non-interactive` in CI
- `.hooks/post-worktree-create.sh`: runs `env-setup.ts --target root:local --non-interactive --source "$MAIN_ROOT"`
- `source-reader.ts` for `root:local` also checks `<source>/.env` as backward-compat fallback
