# Documentation Index

## Evergreen Docs

These documents are updated in-place to reflect current system behavior.

| Doc | Description |
|-----|-------------|
| [Architecture](./architecture.md) | System structure, monorepo layout, request lifecycle, deployment topology, build model |
| [Environment Variables](./environment-variables.md) | All env vars, Zod schemas, validation rules, dependency graph, file generation flow |
| [Auth and Session](./auth-and-session.md) | OAuth flow, dev_bypass, demo mode, session cookies, identity resolution |
| [CI/CD](./ci-cd.md) | GitHub Actions pipeline, deploy workflows, PR gate, deploy script phases |
| [Runbook](./runbook.md) | How to run locally, deploy, troubleshoot, roll back, manage secrets |
| [Backend Dossier](./backend-db-api-architecture-dossier.md) | Postgres schema, ER diagram, API route catalog, persistence write paths |
| [Web Frontend Architecture](./web-frontend-architecture.md) | Component layering, auth middleware, session resolution, review rules |
| [Canonical Accounting Model](./canonical-accounting-model.md) | Accounting entities, terminology, invariants, lifecycle rules |
| [Glossary](./glossary.md) | Domain terms, project conventions, system concepts |

## Reference Docs

| Doc | Description |
|-----|-------------|
| [macOS VM Docker Setup](./macos-vm-docker-setup.md) | Mac-specific Docker environment configuration |
| [ADRs](./adr/) | Architecture Decision Records |

## Frozen Snapshots (`notes/`)

Design notes and session outputs. These are **not updated** after merge — they record what was true at the time.

| Series | Topic |
|--------|-------|
| [OAuth & Env Refactor](./notes/oauth-env-refactor/) | Env variable refactor plan, team reviews, auth flow design, implementation TODOs, transition guides |
| [Additive Accounting](./notes/additive-accounting-migration-compatibility.md) | Migration compatibility analysis |
| [Execution Queue](./notes/execution-queue-alignment.md) | Queue alignment design |
| [Postgres Date Normalization](./notes/postgres-date-normalization.md) | Date handling patterns |
| [Posted Fact Correction](./notes/posted-fact-correction-rules.md) | Correction and reversal rules |

## Implementation Plans

| Doc | Description |
|-----|-------------|
| [KZO-11 Fixture & Test Plan](./kzo-11-fixture-and-test-plan.md) | Test fixture strategy |
| [KZO-11 Implementation Split](./kzo-11-implementation-split.md) | Implementation breakdown |
| [KZO-14 Migration Strategy](./kzo-14-migration-strategy.md) | Migration approach |
| [KZO-33 Dividend Lifecycle](./kzo-33-dividend-lifecycle.md) | Dividend feature design |
| [Acceptance Test Mapping](./acceptance-test-mapping.md) | Test coverage mapping |
