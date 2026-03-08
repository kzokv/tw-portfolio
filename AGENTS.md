# AGENTS.md

## Project overview
- Monorepo baseline policy for contributors working anywhere in this repository.
- Nearest local `AGENTS.md` is authoritative for folder-specific instructions.
- Use this file for global rules only; avoid adding domain-local implementation details.

## Read-before-work files
- Read this root `AGENTS.md` first, then the nearest local `AGENTS.md` for the area you are changing.
- For meaningful resumed work, read `.worklog/latest-handoff.md` first.
- Read `.worklog/current-focus.md` and `.worklog/open-questions.md` when they exist and are relevant.
- Use domain-specific `AGENTS.md` files only where behavior genuinely differs, such as `apps/web/AGENTS.md`, `apps/api/AGENTS.md`, and `infra/AGENTS.md`.

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

## Knowledge curation
- Canonical knowledge for this repo lives in repository markdown. Do not use Basic Memory MCP for this workflow.
- Use `AGENTS.md` for stable repo-wide rules and repeated corrections.
- Use `docs/notes/` for durable technical notes, gotchas, caveats, and investigation outcomes.
- Use `docs/adr/` for meaningful design, architecture, and strategy decisions with rationale.
- Use `.worklog/` for transient task state, next steps, blockers, risks, and handoff.
- Promote only repeated corrections, reusable workflows, meaningful decisions, or expensive-to-rediscover gotchas.
- If nothing meets that threshold, say so explicitly and do not force promotion.
- Prefer one concept, one home. Avoid duplicating the same guidance across `AGENTS.md`, notes, ADRs, and handoff files unless there is a strong reason.
- During meaningful work, suggest the single best follow-up action when durable knowledge appears.
- Before ending meaningful implementation, debugging, refactor, or handoff work, run curation and refresh `.worklog/latest-handoff.md` when resumability matters.
- Shared workflow assets live outside this repo: use the shared `knowledge-curator` skill discovered via `$HOME/.agents/skills/knowledge-curator/` and the shared prompt wrappers under `~/.codex/prompts/`.
- Keep `AGENTS.md` lean. Do not put current task status, bug timelines, big narrative progress reports, personal reminders, or long architecture essays here.

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
