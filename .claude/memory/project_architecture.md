---
name: vakwen architecture overview
description: Monorepo structure, tech stack, workspace layout, and key architectural patterns for the Vakwen multi-market portfolio intelligence application
type: project
---

## Monorepo Structure

npm workspaces monorepo with three workspace roots: `apps/*`, `libs/*`.

### Apps
- **`apps/api`** — Fastify 5.1 backend (port 4000). Routes in `src/routes/registerRoutes.ts`, persistence in `src/persistence/{postgres,memory}.ts`, services in `src/services/`.
- **`apps/web`** — Next.js 16.1 frontend (port 3000). App Router in `app/`, feature modules in `features/{dashboard,portfolio,settings}/`, shared components in `components/`.

### Libs
- **`libs/domain`** — Pure business logic: fee calculations, tax rules, weighted-average cost basis, lot allocation. No I/O.
- **`libs/shared-types`** — TypeScript interfaces shared between API and Web (`UserSettings`, `AccountDto`, `FeeProfileDto`, DTOs).

### Database
- **`db/migrations/`** — Numbered migrations + `baseline_current_schema.sql` + `manifest.env`. Use `ls db/migrations/` for the current list; baseline absorbs older numbered migrations periodically.
- PostgreSQL 15+ with Redis for caching/idempotency.

### Infrastructure
- **`infra/docker/`** — Docker Compose for dev, prod, CI integration.
- **`scripts/`** — `onboard.sh`, `dev.sh`, `test-integration-ci-host.sh`, etc.

## Tech Stack
- Node.js 24.13.0+, TypeScript 5.6.3 (strict mode)
- Fastify 5.1, Zod 3.23 (API validation)
- React 18.3, Next.js 16.x, Tailwind CSS 3.4, Radix UI
- PostgreSQL + Redis 4.7
- Vitest 4.0 (unit + integration), Playwright 1.51 (E2E)
- ESLint 9.15 + TypeScript ESLint

## Key Patterns
- In-memory `Store`/`AccountingStore` model mutated first, persisted second
- Incremental persistence for trade and dividend posting; full rewrite for settings/config
- Tenant isolation via `userId` on all queries; composite FK `(account_id, user_id)` on fact tables
- Append-only accounting facts with reversal+replacement correction model
- Migration runner with baseline bootstrap for fresh DBs and numbered chain for upgrades

**Why:** Understanding this structure is essential for navigating the codebase and making changes in the right locations.
**How to apply:** Use this when deciding where to place new code, which workspace to modify, and how persistence flows work.
