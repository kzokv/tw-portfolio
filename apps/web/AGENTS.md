# AGENTS.md (apps/web)

## Project overview
- Follow root AGENTS for global baseline.
- Next.js frontend package for UI, feature modules, and user-facing state flows.
- Keep feature boundaries clear between services, mappers, validators, hooks, and components.

## Build and test commands
- Dev server: `npm run dev -w apps/web`.
- Build package: `npm run build -w @tw-portfolio/web`.
- Start built app: `npm run start -w apps/web`.
- Run web unit tests: `npm run test:unit -w apps/web`.
- Run web e2e suite from repo root: `npm run test:e2e`.

## Code style guidelines
- TypeScript policy: keep `compilerOptions.strict` enabled for web tsconfig.
- Keep presentational components free of backend-only data-shape concerns.
- Put API calls in service layers and data translation in mapper layers.
- Route translatable UI copy through i18n modules.

## Testing instructions
- Add unit tests for changed validators, mappers, services, and hooks.
- Run relevant e2e flows for routing, submission, or contract-impacting UI changes.
- Keep selectors stable for UI elements covered by e2e tests.

## Security considerations
- Avoid exposing sensitive runtime values in client code paths.
- Validate and sanitize user input before request submission.
- Keep environment-specific API endpoints explicit and correct.

## Context7 standards sources
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
