# AGENTS.md (apps/web/tests/e2e)

## Project overview
- Follow root AGENTS for global baseline.
- Playwright-specific guidance for end-to-end tests in this folder only.
- Keep e2e specs focused on user-visible critical flows and regressions.

## Build and test commands
- Run e2e suite: `npm run test:e2e`.
- Run CI reporter mode: `npm run test:e2e:ci`.
- Open Playwright report: `npm run test:e2e:show-report`.
- Run single spec when iterating: `npx playwright test tests/e2e/specs/<spec>.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`.

## Code style guidelines
- TypeScript policy: keep `compilerOptions.strict` enabled for test TypeScript configs.
- Prefer role, label, and `data-testid` locators over brittle CSS/XPath chains.
- Use web-first assertions and avoid manual immediate visibility checks.
- Avoid fixed sleeps unless no deterministic wait condition is possible.

## Testing instructions
- Keep each test isolated with explicit setup and no hidden inter-test state dependency.
- Assert user-visible outcomes instead of implementation details.
- Reduce flakiness by waiting on deterministic UI/network milestones.
- Add or update coverage for critical journeys when related features change.

## Security considerations
- Do not place secrets or tokens in test data, fixtures, or committed artifacts.
- Keep auth stubs and test identities limited to non-production contexts.
- Avoid logging sensitive payload values in traces or debugging output.

## Context7 standards sources
- `/microsoft/playwright.dev`
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
