# AGENTS.md (libs/shared-types)

## Project overview
- Follow root AGENTS for global baseline.
- Shared type-contract package for API and web integration boundaries.
- Treat type changes as cross-package interface changes.

## Build and test commands
- Build package: `npm run build -w libs/shared-types`.
- Validate API impact: `npm run test:integration`.
- Validate web impact: `npm run test:unit -w apps/web`.
- Run e2e when contract changes affect user flows: `npm run test:e2e`.

## Code style guidelines
- TypeScript policy: keep `compilerOptions.strict` enabled for shared-types tsconfig.
- Keep this package contract-centric and free of runtime business logic.
- Prefer additive, backward-compatible contract evolution when feasible.
- Keep names and shapes explicit to reduce cross-app drift.

## Testing instructions
- Rebuild package before running downstream validation.
- Verify both API and web behavior for contract changes.
- Add cross-package checks for any intentional breaking change.

## Security considerations
- Keep ownership and identity fields explicit in shared contracts.
- Do not encode secrets or environment-specific sensitive values in types.
- Document and coordinate breaking interface changes in one PR.

## Context7 standards sources
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
