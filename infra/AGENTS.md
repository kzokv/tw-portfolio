# AGENTS.md (infra)

## Project overview
- Follow root AGENTS for global baseline.
- Infrastructure folder for compose, deployment, migration, and backup operations.
- Keep infra behavior deterministic and aligned with runbook documentation.

## Build and test commands
- Validate local compose config: `docker compose -f infra/docker/docker-compose.yml config`.
- Validate env-specific compose files: `docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/fixtures/env.prod.ci config` and `docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/fixtures/env.dev.ci config`.
- Validate local Docker stack (build, migrate, up, healthcheck): `npm run docker:validate` (alias for `bash infra/scripts/validate-local.sh`). Use `npm run docker:validate:teardown` to remove containers after validation. Pass `--env-file` directly to the script to specify a custom env file (defaults to `infra/docker/.env.local`). Generate `infra/docker/.env.local` first via `npm run env:setup -- --target docker:local`.
- Validate local compose file directly: `docker compose -f infra/docker/docker-compose.local.yml --env-file infra/docker/.env.local config`.
- Rebuild and restart a single service without a full deploy: `bash infra/scripts/redeploy-service.sh -e <env> [--with-deps] <service>`. Environments: `local`, `dev`, `production`. Services: `api`, `web`.
- Run migration script when needed: `bash infra/scripts/run-migrations.sh`.
- Run backup script when needed: `bash infra/scripts/backup-postgres.sh --environment dev`.
- Run impacted app checks after infra changes: `npm run test:integration` and `npm run test:e2e`.
- Docker image builds are validated on every PR by the `docker-build-validation` CI job.

## Code style guidelines
- Keep scripts non-interactive-safe and explicit about required environment inputs.
- Prefer idempotent operations with clear error exits and logs.
- Keep compose, scripts, and runbook behavior synchronized in the same PR.
- Minimize mutable operational defaults where reproducibility matters.

## Testing instructions
- Include compose validation evidence for infra changes.
- Include rollback steps and verification evidence for deploy-path updates.
- Include migration and backup evidence for data-path changes.

## Security considerations
- Enforce least-privilege access for deploy credentials and backup handling.
- Keep production-sensitive operational settings explicit and auditable.
- Avoid unsafe defaults in deployment and restore flows.

## Context7 standards sources
- Use root Context7 sources from `/home/ubuntu/github/tw-portfolio/AGENTS.md`.
