---
name: libs/config package structure and export rules
description: How @vakwen/config is structured, what it exports, and critical side-effect constraint
type: project
---

`libs/config` is the shared environment config library (`@vakwen/config`). Uses Zod for schema validation.

**Why:** Centralizes env loading, validation, and typed access across API, web, and scripts.

**How to apply:** When adding new env vars or config schemas, add them here first.

## Key files

- `src/env-schema.ts` — **side-effect-free** schema module. Exports `envSchema`, `parseDotEnvLine`, `EnvConfig`. Safe to import from scripts.
- `src/env.ts` — has side effects: calls `loadDotEnv()` and `envSchema.parse(process.env)` at module load. Exports `Env` object, `GoogleOAuthEnvConfig`. Also re-exports `envSchema` and `EnvConfig` from env-schema.ts.
- `src/env-metadata.ts` — grouping metadata for env-setup CLI. No side effects.
- `src/env-docker.ts` — `dockerDevSchema`, `dockerProdSchema` (extends envSchema).
- `src/env-web.ts` — `webEnvSchema` (standalone, NEXT_PUBLIC_* vars only).
- `src/test.ts` — `TestEnv` for Playwright/Vitest: `apiServerEnv()`, `webServerEnv()`, `loadDotEnvSync()`.
- `src/index.ts` — `export * from "./env.js"` (triggers side effects on import)

## Package exports

```json
".":         dist/index.js        (has side effects)
"./test":    dist/test.js
"./schema":  dist/env-schema.js   (side-effect-free)
"./docker":  dist/env-docker.js
"./web":     dist/env-web.js
"./metadata": dist/env-metadata.js
```

## Critical constraint

Scripts that need schema introspection (like env-setup.ts) MUST import from `./env-schema.js`, NOT from the root `@vakwen/config`. The root triggers `loadDotEnv()` and `envSchema.parse(process.env)` which corrupts the interactive session.

## loadDotEnv() behavior

Walks up from compiled file location to find workspace root (package.json with "workspaces" field), then loads `.env.local`. Respects `APP_ENV_FILE` env var for Docker/CI override. Only sets vars not already in `process.env` (preserves vitest test.env overrides — P2).
