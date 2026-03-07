# AGENTS.md

## Project overview
- Monorepo baseline policy for contributors working anywhere in this repository.
- Nearest local `AGENTS.md` is authoritative for folder-specific instructions.
- Use this file for global rules only; avoid adding domain-local implementation details.

## Build and test commands
- Setup: `npm run onboard`.
- Build all workspaces: `npm run build`.
- Run lint: `npm run lint`.
- Run core tests: `npm run test:unit`, the managed API integration command for your runtime (`npm run test:integration:ci:host` on `Darwin`; `npm run test:integration:ci:container` on `Linux`), then `npm run test:e2e`.
- Start dev by mode:
- `PERSISTENCE_BACKEND=memory`: run `npm run dev`.
- `PERSISTENCE_BACKEND=postgres` with external `DB_URL`/`REDIS_URL`: run `npm run dev`.
- `PERSISTENCE_BACKEND=postgres` with local/default URLs: run `docker compose -f infra/docker/docker-compose.yml up -d` then `npm run dev`.

## Code style guidelines
- TypeScript policy: `compilerOptions.strict` must remain `true` in project tsconfig chains.
- Keep lint clean under the repo ESLint configuration.
- Prefer small, focused changes with clear intent and minimal churn.
- Keep commands and docs synchronized when scripts or workflows change.

## Testing instructions
- Run the smallest relevant test scope first, then run broader regression checks.
- For managed API Postgres integration runs, use `npm run test:integration:ci:host` on the macOS host or lume VM shell, and `npm run test:integration:ci:container` in a Linux container shell.
- Include `## Testing` evidence in PRs with exact commands and outcomes.
- If a check is skipped, record reason, approver, and planned follow-up.

## Security considerations
- Never commit secrets, private keys, or real environment credentials.
- Keep authentication mode expectations explicit for non-development environments.
- Keep CORS and write-path throttling configuration explicit and policy-driven.
- Preserve tenant/data ownership boundaries when changing persistence or APIs.

## Context7 standards sources
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
- `/microsoft/playwright.dev`
