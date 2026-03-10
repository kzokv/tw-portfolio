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
- Follow the user-level `Knowledge Capture Defaults`, `Knowledge Capture Behavior`, and `Linear Workflow Defaults` unless a nearer local `AGENTS.md` overrides them.
- This repo uses the standard knowledge layout.
- `AGENTS.md` for stable repo-wide rules and repeated corrections.
- `docs/notes/` for durable technical notes, gotchas, caveats, and investigation outcomes.
- `docs/adr/` for meaningful design, architecture, and strategy decisions with rationale.
- `.worklog/latest-handoff.md` for transient resumability state.
- `.worklog/current-focus.md` and `.worklog/open-questions.md` remain optional transient supporting context when useful.
- No repo-specific curation or Linear workflow overrides currently.

## Testing instructions
- Run the smallest relevant test scope first, then run broader regression checks.
- For managed API Postgres integration runs, use `npm run test:integration:ci:host` on the macOS host or lume VM shell, and `npm run test:integration:ci:container` in a Linux container shell.
- Include `## Testing` evidence in PRs with exact commands and outcomes.
- If a check is skipped, record reason, approver, and planned follow-up.

## Git and PR gate rules
- This repository is Linear-driven. Commit subjects and PR titles must use `type(scope): LINEAR-TICKET: subject` (example: `feat(api): KZO-33: define dividend lifecycle`).
- The only naming waiver path is PR label `waiver:linear-ticket` plus `## Waiver` fields `Reason:`, `Approved-by: @handle`, and `Scope: title|commits|both`.
- For solo-maintainer repositories, `Approved-by` may be the PR author only when they are the only human collaborator with write, maintain, or admin access.
- User-stated waiver intent overrides inferred ticket matching. If the user explicitly says a PR or commit should use the waiver path, do not attach a Linear ticket based only on topic similarity or newly discovered issues.
- For git/PR flow, determine naming mode in this precedence order: explicit user instruction, existing branch/commit/PR draft evidence, then repository search. Only use a discovered Linear issue when the user has not indicated waiver intent and the issue is already grounded by repository context.
- If the work is a repo/process improvement and no ticket is already anchored in the branch name, commit history, or explicit user request, pause before creating a ticketed branch, commit, or PR title and confirm whether the waiver path should be used.
- Git orchestrator must look for a related Linear ticket in branch name, recent commit subjects, current commit message draft, and known PR title/body draft context before using the waiver path.
- If no related ticket is found, orchestrator must ask whether to use `waiver:linear-ticket`; if the user declines, block non-compliant commit or PR-title flow.

## Security considerations
- Never commit secrets, private keys, or real environment credentials.
- Keep authentication mode expectations explicit for non-development environments.
- Keep CORS and write-path throttling configuration explicit and policy-driven.
- Preserve tenant/data ownership boundaries when changing persistence or APIs.

## Context7 standards sources
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
- `/microsoft/playwright.dev`
