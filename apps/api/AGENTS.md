# AGENTS.md (apps/api)

## Project overview
- Follow root AGENTS for global baseline.
- Fastify API package for server routes, validation boundaries, and persistence orchestration.
- Keep API behavior consistent across supported persistence backends.

## Build and test commands
- Dev server: `npm run dev -w apps/api`.
- Build package: `npm run build -w @tw-portfolio/api`.
- Run API tests: `npm run test -w apps/api`.
- Run integration tests: `npm run test:integration -w apps/api`.
- Generate reports: `npm run test:html -w apps/api`, `npm run test:json -w apps/api`, `npm run test:junit -w apps/api`.

## Code style guidelines
- TypeScript policy: keep `compilerOptions.strict` enabled for API tsconfig.
- Validate route boundaries before business logic execution.
- Keep handlers thin and move storage details into persistence modules.
- Use explicit API and storage types for request/response/data contracts.

## Testing instructions
- Add or update integration tests for route, payload, or behavior changes.
- Cover success, validation failure, and persistence failure paths.
- Rebuild shared libs before API verification when shared packages change.
- Coordinate with web tests when API contract changes affect UI flows.

## Security considerations
- Preserve tenant isolation in reads and writes.
- Keep query paths parameterized and avoid unsafe dynamic SQL.
- Keep mutation safeguards active for write endpoints.

## Context7 standards sources
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
