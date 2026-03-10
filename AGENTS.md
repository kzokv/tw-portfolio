# AGENTS.md

## Project Overview

- Root policy for this monorepo. The nearest local `AGENTS.md` wins for touched files.
- Read the nearest local `AGENTS.md` before changing a subtree with area-specific rules.

## Session Context

- Read `.worklog/latest-handoff.md`, `.worklog/current-focus.md`, and `.worklog/open-questions.md` only for resumed work or when prior-session context materially affects the task.

## Repo-Specific Rules

- Keep `compilerOptions.strict` enabled across the TypeScript config chain.
- Keep scripts, commands, and docs synchronized when workflows change.
- Run the smallest relevant test scope first, then broader regression checks.
- Use `npm run test:integration:ci:host` on Darwin or the lume VM shell, and `npm run test:integration:ci:container` in Linux containers, for managed API Postgres integration coverage.

## Git And PR Gate

- This repository is Linear-driven: commit subjects and PR titles must use `type(scope): LINEAR-TICKET: subject`.
- The only waiver path is PR label `waiver:linear-ticket` plus `## Waiver` fields `Reason:`, `Approved-by: @handle`, and `Scope: title|commits|both`.
- If the work is repo or process improvement and no ticket is already anchored in the branch, commits, or explicit user request, stop and confirm whether to use the waiver path before creating ticketed git metadata.

## Context7 Sources

- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
- `/microsoft/playwright.dev`
