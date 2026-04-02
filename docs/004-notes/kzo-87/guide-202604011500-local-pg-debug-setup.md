# Local Postgres Debug Environment Setup for AI Agents

**Context:** Debugging market data pipeline (backfill, catalog sync, daily refresh) requires a real Postgres backend. The in-memory persistence backend (`PERSISTENCE_BACKEND=memory`) skips pg-boss entirely (`app.boss = null`), so job queue flows are untestable.

**When to use this guide:** Any time you need to debug pg-boss workers, market data ingestion, migration issues, or any Postgres-specific behavior that cannot be reproduced with the memory backend.

---

## Quick Start

### 1. Start Postgres + Redis containers

```bash
docker compose --env-file infra/docker/.env.local \
  -f infra/docker/docker-compose.local.yml \
  up -d twp-local-postgres twp-local-redis
```

Only start the infrastructure containers (`twp-local-postgres`, `twp-local-redis`). Do NOT start `twp-local-api` or `twp-local-web` — you will run the API on the host for debuggability.

Wait for Postgres to be healthy before proceeding:

```bash
for i in {1..10}; do
  status=$(docker inspect --format='{{.State.Health.Status}}' twp-local-postgres 2>/dev/null)
  [ "$status" = "healthy" ] && echo "Postgres healthy" && break
  echo "Waiting... ($status)" && sleep 3
done
```

### 2. Run migrations

```bash
docker compose --env-file infra/docker/.env.local \
  -f infra/docker/docker-compose.local.yml \
  --profile migrate up twp-local-migrate
```

The migrate container runs and exits. Check output for `No pending migrations` (clean DB) or a list of applied migration filenames.

### 3. Determine the Docker host IP

This is the critical step that varies by environment:

```bash
echo "DOCKER_HOST=$DOCKER_HOST"
```

| Environment | Docker host IP | Why |
|---|---|---|
| **macOS native** (Docker Desktop) | `localhost` / `127.0.0.1` | Docker port-forwards to localhost |
| **Lume VM** (`DOCKER_HOST=tcp://192.168.64.1:...`) | `192.168.64.1` | Docker runs on the Mac host, not inside the VM |
| **Linux native** | `localhost` / `127.0.0.1` | Docker port-forwards to localhost |

**Verify connectivity before proceeding:**

```bash
DOCKER_IP=192.168.64.1  # or localhost — adjust for your environment
nc -z -w2 $DOCKER_IP 5732 && echo "Postgres OK" || echo "Postgres UNREACHABLE"
nc -z -w2 $DOCKER_IP 6679 && echo "Redis OK" || echo "Redis UNREACHABLE"
```

If ports are unreachable from `localhost`, check `DOCKER_HOST` and use the host machine's IP instead.

### 4. Start the API on the host

```bash
DOCKER_IP=192.168.64.1  # adjust per step 3

DB_URL="postgres://twp:62421c6c89223536a966d562c2f48e307c17630356407243d5199c9ca2784a2a@${DOCKER_IP}:5732/tw_portfolio" \
REDIS_URL="redis://:d2395eea11d012e6de66290550fc6b0db90c13c71483fbb2ae7415c3b3f685b5@${DOCKER_IP}:6679" \
PERSISTENCE_BACKEND=postgres \
AUTH_MODE=dev_bypass \
API_PORT=4100 \
NODE_ENV=development \
DEMO_MODE_ENABLED=true \
ALLOWED_ORIGINS="http://localhost:3333,http://localhost:4100" \
DATA_PROVIDER_TIMEOUT_MS=3000 \
RATE_LIMIT_WINDOW_MS=60000 \
RATE_LIMIT_MAX_MUTATIONS=120 \
SESSION_SECRET=test-secret-for-local-debug \
SESSION_COOKIE_NAME=g_auth_session \
APP_BASE_URL=http://localhost:3333 \
GOOGLE_REDIRECT_URI=http://localhost:4100/auth/google/callback \
GOOGLE_CLIENT_ID=fake \
GOOGLE_CLIENT_SECRET=fake \
node apps/api/dist/server.js
```

**Key environment choices:**

| Variable | Value | Why |
|---|---|---|
| `AUTH_MODE=dev_bypass` | Skips OAuth — all requests resolve to `user-1` | Simplifies debugging, no cookie/session needed |
| `API_PORT=4100` | Non-standard port | Avoids collision with any running dev servers |
| `GOOGLE_REDIRECT_URI` port | Must match `API_PORT` | `validateEnvConstraints()` checks port consistency at startup |
| `GOOGLE_CLIENT_ID/SECRET` | `fake` | Required by env schema but unused in `dev_bypass` mode |
| No `FINMIND_API_TOKEN` | Uses `MockFinMindClient` automatically | `pgBoss.ts:36` selects mock when token is absent |

**Successful startup logs:**

```
backfill worker registered
catalog sync worker registered
pg-boss started, market-data workers registered
Server listening at http://[::]:4100
```

Verify health:

```bash
curl -s http://localhost:4100/health/live
# {"status":"ok"}
```

### 5. Interact with the API

```bash
# List instruments
curl -s http://localhost:4100/instruments | python3 -m json.tool

# Select monitored ticker (triggers backfill)
curl -s -X PUT http://localhost:4100/monitored-tickers \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["0056"]}' | python3 -m json.tool

# Check backfill status
curl -s http://localhost:4100/monitored-tickers | python3 -m json.tool

# Retry a failed backfill
curl -s -X POST http://localhost:4100/backfill/retry \
  -H "Content-Type: application/json" \
  -d '{"ticker": "0056"}' | python3 -m json.tool
```

### 6. Inspect pg-boss job state

```bash
PGPASSWORD=62421c6c89223536a966d562c2f48e307c17630356407243d5199c9ca2784a2a \
docker exec twp-local-postgres psql -U twp -d tw_portfolio -c "
SELECT id, name, state, retry_count,
  LEFT(output::text, 300) as output_snippet
FROM pgboss.job
WHERE name IN ('finmind-backfill', 'catalog-sync')
ORDER BY created_on DESC LIMIT 10;
"
```

**pg-boss column names** use `snake_case` (`created_on`, `started_on`, `completed_on`, `retry_count`), not `camelCase`.

### 7. Inspect market data tables

```bash
PGPASSWORD=62421c6c89223536a966d562c2f48e307c17630356407243d5199c9ca2784a2a \
docker exec twp-local-postgres psql -U twp -d tw_portfolio -c "
-- Instrument catalog status
SELECT ticker, name, instrument_type, bars_backfill_status, last_synced_at
FROM market_data.instruments ORDER BY ticker;

-- Daily bars count per ticker
SELECT ticker, COUNT(*) as bars FROM market_data.daily_bars GROUP BY ticker;

-- Dividend events
SELECT id, ticker, event_type, ex_dividend_date, cash_dividend_per_share
FROM market_data.dividend_events ORDER BY ex_dividend_date;
"
```

### 8. Cleanup

```bash
# Stop the API (Ctrl+C or kill)
kill $(lsof -ti:4100) 2>/dev/null

# Stop and remove containers
docker compose --env-file infra/docker/.env.local \
  -f infra/docker/docker-compose.local.yml down

# To also remove the persistent volume (full reset):
docker compose --env-file infra/docker/.env.local \
  -f infra/docker/docker-compose.local.yml down -v
```

---

## Port Reference

| Service | Container port | Host port | Notes |
|---|---|---|---|
| Postgres | 5432 | **5732** | From `docker-compose.local.yml` |
| Redis | 6379 | **6679** | From `docker-compose.local.yml` |
| API (host) | — | **4100** | Set via `API_PORT`, avoids collision |

---

## Pitfalls Encountered

### 1. `DOCKER_HOST` in Lume VM

**Symptom:** `nc -z localhost 5732` fails even though Docker says the container is running and healthy.

**Cause:** In the Lume VM, Docker runs on the Mac host (`DOCKER_HOST=tcp://192.168.64.1:23750`). Port mappings bind to the Mac's `0.0.0.0`, not the VM's localhost. The `docker` CLI works because it communicates via the TCP socket, but `localhost:5732` inside the VM doesn't reach the Mac's port.

**Fix:** Use `192.168.64.1` (the Mac host IP from the VM bridge) instead of `localhost` in `DB_URL` and `REDIS_URL`.

**Detection:**
```bash
echo $DOCKER_HOST  # If set to tcp://..., you're remote
hostname           # If "lumes-Virtual-Machine", you're in the VM
```

### 2. `GOOGLE_REDIRECT_URI` port mismatch

**Symptom:** API crashes on startup with `GOOGLE_REDIRECT_URI port (4000) does not match API_PORT (4100)`.

**Cause:** `.env.local` sets `GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback`. The `validateEnvConstraints()` function checks that the port in the redirect URI matches `API_PORT`. When using a custom port (4100), the URI must be overridden.

**Fix:** Set `GOOGLE_REDIRECT_URI=http://localhost:4100/auth/google/callback` matching your `API_PORT`.

### 3. `REDIS_PASSWORD` not interpolated

**Symptom:** `docker compose ... up` fails with `required variable REDIS_PASSWORD is missing a value`.

**Cause:** `docker-compose.local.yml` uses `${REDIS_PASSWORD:?...}` which requires the variable to be set. Running without `--env-file` doesn't source `infra/docker/.env.local`.

**Fix:** Always pass `--env-file infra/docker/.env.local` to docker compose commands.

### 4. `array_fill(text, text[])` — the actual bug found

**Symptom:** Backfill jobs fail with `function array_fill(text, text[]) does not exist`. The instrument stays stuck at `backfilling` forever (pg-boss retries silently).

**Cause:** In `apps/api/src/services/market-data/upserts.ts`, the `array_fill()` PostgreSQL function was called as:
```sql
array_fill('finmind'::text, ARRAY[$8])
```
The `$8` parameter (array length) is sent by node-pg as a text value. PostgreSQL infers `ARRAY[$8]` as `text[]`, but `array_fill()` requires `int[]` as its second argument.

**Fix:** Explicit cast: `ARRAY[$8::int]` in all `array_fill` calls (5 occurrences across `upsertDailyBars` and `upsertDividendEvents`).

**Diagnosis method:** Query `pgboss.job` table directly and read the `output` column — it contains the full error stack trace including the PostgreSQL error code and message.

### 5. Memory backend skips pg-boss entirely

**Symptom:** Selecting a monitored ticker returns `newTickers` in the response but nothing happens — no backfill, no SSE events.

**Cause:** When `PERSISTENCE_BACKEND=memory`, `registerPgBoss()` sets `app.boss = null` and returns immediately. All backfill/catalog-sync code is guarded by `if (app.boss && ...)`, so the entire market data pipeline is silently disabled.

**Implication:** You cannot debug any market data flow without Postgres. The memory backend is only useful for transaction/portfolio features.

### 6. Mock vs real FinMind client

**Behavior:** `pgBoss.ts:36` selects the client:
```ts
const finmind = Env.FINMIND_API_TOKEN ? new FinMindClient() : new MockFinMindClient();
```

The mock client returns 30 deterministic bars and 2 dividend events per ticker instantly. The mock instrument catalog contains only: 2330, 2317, 0050, 00679B, 020000, IX0001, IX0099, 006201. Notable absences: **0056 and 00919 are NOT in the mock catalog** — they exist only as default instruments seeded by `instrumentRegistry.ts`.

To test with real FinMind data, set `FINMIND_API_TOKEN` in the environment. Rate limit: 600 requests/hour.

---

## Accessing Docker Web Containers from the Lume VM

When running the full Docker stack (API + Web containers) inside the Lume VM, Docker ports bind to the Mac host (`192.168.64.1`), not the VM's `localhost`. Chrome inside the VM can reach `192.168.64.1:3300`, but OAuth callbacks redirect to `localhost:4300` — which fails because nothing listens on the VM's localhost.

**Solution: SSH local port forwarding from VM → Mac host.**

### Prerequisites

Add Mac host credentials to `.env.local` (root):

```env
## Host
MAC_USER=<your-mac-username>
MAC_PASSWORD=<your-mac-password>
```

These are managed by `npm run env:setup` and masked in console output.

### Setup

```bash
# Read credentials from .env.local
MAC_USER=$(grep '^MAC_USER=' .env.local | cut -d= -f2)
MAC_PASSWORD=$(grep '^MAC_PASSWORD=' .env.local | cut -d= -f2)

# Forward VM localhost → Mac host Docker ports
sshpass -p "$MAC_PASSWORD" ssh \
  -o StrictHostKeyChecking=no \
  -o PreferredAuthentications=password \
  -N \
  -L 3300:localhost:3300 \
  -L 4300:localhost:4300 \
  "$MAC_USER@192.168.64.1" &
SSH_PID=$!

# Verify
curl -s http://localhost:4300/health/live  # Should return {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}' http://localhost:3300/  # Should return 307
```

### Why this works

- SSH binds `localhost:3300` and `localhost:4300` inside the VM
- Traffic tunnels to the same ports on `192.168.64.1` (Mac host) where Docker exposes them
- Chrome accesses `localhost:3300` — the OAuth callback to `localhost:4300` resolves natively
- The full Google OAuth flow completes without redirect URI mismatches

### When to use

| Scenario | Approach |
|---|---|
| Need OAuth flow in browser with Docker containers | SSH tunnel (this section) |
| Debugging API with breakpoints / live reload | Host-level API (section above) |
| Just testing API endpoints via curl | Use `192.168.64.1:4300` directly |

### Cleanup

```bash
kill $SSH_PID 2>/dev/null
```

---

## Alternative: Full Docker Stack

If you don't need host-level debugging (breakpoints, live code changes), use the all-in-one Docker approach:

```bash
# Full stack with migrations
docker compose --env-file infra/docker/.env.local \
  -f infra/docker/docker-compose.local.yml \
  --profile migrate up --build

# Or via npm script
npm run dev:docker:oauth:pg
```

This starts Postgres (5732), Redis (6679), API (4300), and Web (3300) as Docker containers. Less flexible for debugging but zero configuration.

---

## Quick Reference: Reset Database State

```bash
# Reset a specific instrument's backfill status
PGPASSWORD=62421c6c89223536a966d562c2f48e307c17630356407243d5199c9ca2784a2a \
docker exec twp-local-postgres psql -U twp -d tw_portfolio -c "
UPDATE market_data.instruments SET bars_backfill_status = 'failed' WHERE ticker = '0056';
DELETE FROM pgboss.job WHERE name = 'finmind-backfill' AND state IN ('retry', 'active', 'created');
"

# Wipe all market data (keep schema)
PGPASSWORD=... docker exec twp-local-postgres psql -U twp -d tw_portfolio -c "
TRUNCATE market_data.daily_bars, market_data.dividend_events CASCADE;
UPDATE market_data.instruments SET bars_backfill_status = 'pending', last_synced_at = NULL;
"
```
