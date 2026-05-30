# AGENTS.md (libs/domain)

## Project overview
- Follow root AGENTS for global baseline.
- Shared domain library for deterministic portfolio math and accounting rules.
- Keep this package framework-agnostic and side-effect free.

## Build and test commands
- Build package: `npm run build -w libs/domain`.
- Run package tests: `npm run test -w libs/domain`.
- Run root domain suite shortcut: `npm run test:unit`.
- Run downstream API regression after rule changes: `npm run test:integration`.

## Code style guidelines
- TypeScript policy: keep `compilerOptions.strict` enabled for domain tsconfig.
- Keep functions pure with no I/O, network, database, or env coupling.
- Make rounding and fee/tax behaviors explicit in code paths.
- Keep types and formulas readable, deterministic, and easy to verify.

## Testing instructions
- Add unit tests for every rule or formula change.
- Cover boundary values, rounding behavior, and negative/error paths.
- Verify dependent API behavior after domain changes.

## Security considerations
- Treat calculation correctness as integrity-critical for financial outcomes.
- Reject invalid inputs explicitly and avoid silent coercion.
- Preserve deterministic outputs across environments.

## Context7 standards sources
- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
