# AGENTS.md (db)

## Project overview
- Follow root AGENTS for global baseline.
- Database folder for migration files and schema-evolution rules.
- Keep migration changes safe, reviewable, and operationally repeatable.

## Build and test commands
- Start local DB stack: `docker compose -f infra/docker/docker-compose.yml up -d`.
- Run migration profile: `docker compose --project-name twp-dev -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev --profile migrate run --rm twp-dev-migrate`.
- Run backup command before risky changes: `bash infra/scripts/backup-postgres.sh --environment dev`.
- Run integration checks after schema changes: `npm run test:integration`.

## Code style guidelines
- Keep migrations append-only and avoid rewriting applied migration history.
- Prefer additive schema evolution over destructive changes.
- Add constraints and indexes when integrity or query behavior requires them.
- Keep SQL explicit and understandable in review.

## Testing instructions
- Validate migration on a clean database.
- Validate re-run behavior on an already-migrated database.
- Confirm application-level integration behavior after schema changes.

## Security considerations
- Preserve tenant ownership and data integrity invariants in schema changes.
- Treat backup artifacts as sensitive operational data.
- Document practical rollback strategy for high-risk migrations.

## Context7 standards sources
- Use root Context7 sources from `/home/ubuntu/github/tw-portfolio/AGENTS.md`.
