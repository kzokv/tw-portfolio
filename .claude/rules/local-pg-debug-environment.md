# Local Postgres Debug Environment

When debugging any of these features, you MUST use a real Postgres backend — the memory backend silently disables the entire pipeline (`app.boss = null`):

- pg-boss job queues (backfill, catalog sync, daily refresh)
- Market data ingestion (upserts to `market_data.*` tables)
- Migration issues
- Any `PERSISTENCE_BACKEND=postgres`-specific behavior

**Setup guide:** `docs/004-notes/kzo-87/guide-202604011500-local-pg-debug-setup.md`

The guide covers: Docker container startup, migration, host-level API startup with correct env vars, pg-boss job inspection queries, and known pitfalls (Lume VM Docker host IP, port mismatches, env file sourcing).

**Quick start summary:**
1. `docker compose --env-file infra/docker/.env.local -f infra/docker/docker-compose.local.yml up -d vakwen-local-postgres vakwen-local-redis`
2. Run migrations with `--profile migrate`
3. Check `DOCKER_HOST` — if in Lume VM, use `192.168.64.1` not `localhost` for DB/Redis URLs
4. Start API on host with `PERSISTENCE_BACKEND=postgres AUTH_MODE=dev_bypass API_PORT=4100`
5. Inspect jobs via `pgboss.job` table (columns use `snake_case`: `created_on`, not `createdon`)

**How to apply:** When the user reports market data bugs, backfill failures, or asks to debug pg-boss jobs. Do not attempt to debug these with `PERSISTENCE_BACKEND=memory`.
