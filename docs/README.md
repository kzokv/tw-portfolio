# Documentation

## Structure

| Directory | Purpose | Lifecycle |
|-----------|---------|-----------|
| `001-architecture/` | System design and architecture docs | Evergreen — update in place |
| `002-operations/` | Runbook, setup guides, test mapping | Evergreen — update in place |
| `003-adr/` | Architecture decision records | Append-only — one ADR per decision |
| `004-notes/` | Frozen technical snapshots | Never update after merge |

## Quick Links

### Architecture

- [Backend, DB & API architecture](001-architecture/backend-db-api.md)
- [Canonical accounting model](001-architecture/canonical-accounting-model.md)
- [Web frontend architecture](001-architecture/web-frontend.md)

### Operations

- [Runbook](002-operations/runbook.md) — deployment, troubleshooting, operational procedures
- [macOS VM Docker setup](002-operations/macos-vm-docker-setup.md)
- [Acceptance test mapping](002-operations/acceptance-test-mapping.md)

### Notes (frozen snapshots)

- `004-notes/001-planning/` — ticket specs and implementation contracts (KZO-11, KZO-14, KZO-33)
- `004-notes/002-accounting/` — accounting patterns, migration compatibility, correction rules
- `004-notes/003-oauth-env-refactor/` — OAuth & env refactor arc (plans, reviews, implementation TODOs, debates)
