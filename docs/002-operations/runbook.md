# Runbook

Operational guide for deploying and operating the **tw-portfolio** stack: local development, production on the QNAP home lab, and related procedures.

For system design details, see:
- [System Architecture](../001-architecture/architecture.md) — monorepo layout, request lifecycle, deployment topology, build model
- [Environment Variables](./environment-variables.md) — all env vars, schemas, validation, generation
- [Auth and Session](../001-architecture/auth-and-session.md) — OAuth flow, demo mode, cookies, identity resolution
- [CI/CD](./ci-cd.md) — GitHub Actions, deploy workflows, PR gate

---

## 1. Prerequisites

- **Docker** and **Docker Compose** on the deployment host
- **Git** (for production: repo cloned on the deploy host)
- **Production**: Configured env file at `infra/docker/.env.prod` (see First-time setup)
- **Production**: Clean git working tree for deploy (or use `--force`; see Deploy script options)

---

## 2. Local Development

### Start services

- `npm run dev` prints a help listing of available dev modes.
- Choose one local mode:
- `npm run dev:local:bypass:mem` — Fastest iteration, no auth, in-memory storage.
- `npm run dev:local:bypass:pg` — Bypass auth, real Postgres. Start Postgres first: `docker compose -f infra/docker/docker-compose.yml up -d`.
- `npm run dev:local:oauth:mem` — Google OAuth, in-memory storage.
- `npm run dev:local:oauth:pg` — Google OAuth, Postgres (closest to prod). Start Postgres first.
- `npm run dev:docker` — Full Docker Compose local stack (oauth + postgres). Use `npm run dev:docker -- --migrate` to run DB migrations.
- `infra/docker/docker-compose.yml` is local fallback Postgres/Redis and is not required for memory mode or external URL mode.

Tip: When `next dev` can't bind to `WEB_PORT` (default `3000` from `.env.example`), a previous instance likely still owns the port. Identify the orphaned process with `ps -ef | grep -i "next dev"` and stop it via `kill <pid>` or `pkill -f "next dev -p"`, then rerun `npm run dev -w apps/web`.
`scripts/kill-next.sh` clears the web and API ports from `.env.local`. Run `./scripts/kill-next.sh` to target both, `./scripts/kill-next.sh web`/`api` for a specific service, or supply any port number directly.


### Build model

- Workspace libraries (`@tw-portfolio/domain`, `@tw-portfolio/shared-types`) are **not** built during `npm install` / `npm ci`. `npm run onboard` now builds them before handing you the lockfile results, but you still need to run `npm run build -w libs/domain -w libs/shared-types` if you skip onboarding or if you edit those packages after the initial setup.
- Local: `npm run dev:local:bypass:mem` (or any `dev:local:*` variant) from repo root starts the API and web dev servers. Onboarding already builds the workspace libs and the dev scripts will rebuild them when the outputs are missing, but rerun `npm run build -w libs/domain -w libs/shared-types` after editing those packages or if you skipped onboarding.
- CI: `npm ci` then explicit `npm run build -w ...` steps for domain/shared-types/api (and web typecheck).
- Production: Dockerfiles run `npm ci` then explicit `npm run build -w ...` in the same order; deploy builds images from the checked-out ref.

### Required env (quick reference)

For full variable documentation, see [Environment Variables](./environment-variables.md). For auth details, see [Auth and Session](../001-architecture/auth-and-session.md).

- `WEB_PORT`, `API_PORT`, `DB_PORT`, `REDIS_PORT` — service ports
- `AUTH_MODE` — `dev_bypass` (local dev) or `oauth` (production-like)
- `PERSISTENCE_BACKEND` — `memory` (fast dev/test) or `postgres` (real storage)
- `DB_URL`, `REDIS_URL` — required when `PERSISTENCE_BACKEND=postgres`
- `ALLOWED_ORIGINS` — comma-separated CORS allowlist
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_MUTATIONS` — mutation rate limiting
- When `AUTH_MODE=oauth`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` required
- When `DEMO_MODE_ENABLED=true`: enables demo sign-in and demo user creation

### Notes

- Use `AUTH_MODE=dev_bypass` for local development only.
- For production-like runs use `AUTH_MODE=oauth`.
- `AUTH_USER_ID` / `NEXT_PUBLIC_AUTH_USER_ID` have been **removed**. If `AUTH_USER_ID` is set in the env file with `AUTH_MODE=oauth`, `deploy.sh` will error. Remove it from any existing env files.
- Recompute history is explicit and audited via preview/confirm APIs (fee profile recompute) or via cascade recompute triggered by transaction delete/edit (KZO-114). Cascade recompute runs asynchronously and publishes results over the SSE stream.
- For local tests without DB/Redis, set `PERSISTENCE_BACKEND=memory`.
- For external Postgres/Redis mode, keep `PERSISTENCE_BACKEND=postgres` and set external `DB_URL`/`REDIS_URL`; do not start local compose DB/Redis unless needed for fallback.

### Local Docker Stack Validation

Use the local Docker stack to validate that Docker images build and the full containerized stack works before pushing to CI. This catches Dockerfile dependency drift that host-level builds don't detect.

#### Setup (one time)

```bash
# Generate the local Docker env file interactively
npm run env:setup -- --target docker:local

# Or non-interactively with defaults (requires manual password editing)
npx tsx scripts/env-setup.ts --target docker:local --non-interactive
```

This creates `infra/docker/.env.local` with the required variables. Edit passwords and Google OAuth credentials as needed.

#### Validate the full stack

```bash
# Build, migrate, start, and health-check — leaves stack running
npm run dev:docker:validate

# Same, but tear down after validation
npm run dev:docker:validate:teardown
```

**What `dev:docker:validate` does** (phases in order):

1. **Preflight** — checks docker, compose file, and env file exist
2. **Build** — `docker compose --profile migrate build` (api, web, migrate images)
3. **Start infra** — postgres and redis, waits for healthy (up to 60s)
4. **Migrate** — runs the migration container against local postgres
5. **Start apps** — api and web containers
6. **Health check** — API at `/health/live` (30s), web at `/` (20s)
7. **Summary** — reports pass/fail and shows `docker compose ps`

If any phase fails, the script collects container logs and exits with code 1.

#### Access the local stack

After validation passes (stack left running):

```bash
# Web app
open http://localhost:3300

# API health
curl http://localhost:4300/health/live

# Connect to local postgres
docker exec -it twp-local-postgres psql -U twp tw_portfolio

# View logs
docker compose -p twp-local -f infra/docker/docker-compose.local.yml logs -f twp-local-api
```

#### Port mappings (host:container, +300 offset)

| Service  | Host port | Container port |
|----------|-----------|----------------|
| Web      | 3300      | 3000           |
| API      | 4300      | 4000           |
| Postgres | 5732      | 5432           |
| Redis    | 6679      | 6379           |

These ports avoid collision with host-level dev servers (`npm run dev:local:*` uses 3000/3333 + 4000).

#### Tear down manually

```bash
# Stop and remove containers (keep volumes)
docker compose -p twp-local -f infra/docker/docker-compose.local.yml down

# Stop, remove containers AND volumes (fresh start)
docker compose -p twp-local -f infra/docker/docker-compose.local.yml down -v
```

#### OAuth in local Docker stack

The local stack defaults to `AUTH_MODE=oauth` (not `dev_bypass`) because:
- The API enforces `dev_bypass` is only allowed when `NODE_ENV=development`
- The Docker stack runs `NODE_ENV=test` by default (configurable via `NODE_ENV` env var), which blocks `dev_bypass`
- `GOOGLE_REDIRECT_URI` is hardcoded to `http://localhost:4300/auth/google/callback` in the compose file (uses host port 4300, not container port 4000)
- `SESSION_COOKIE_NAME` uses `g_auth_session` (no `__Host-` prefix) because local Docker runs on HTTP

To use the local stack with OAuth, ensure your `infra/docker/.env.local` has valid `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` values.

### Redeploy a Single Service

Use `redeploy-service.sh` to rebuild and restart just one service without a full deployment:

```bash
# Rebuild and restart just the web container (local)
bash infra/scripts/redeploy-service.sh -e local web

# Rebuild and restart just the API (dev server)
bash infra/scripts/redeploy-service.sh -e dev api

# Rebuild with dependencies (restarts dependent services too)
bash infra/scripts/redeploy-service.sh -e production --with-deps web
```

**Options:**
- `-e, --environment ENV` — `local`, `dev`, or `production` (required)
- `--with-deps` — also restart services that depend on the target
- `SERVICE` — `api` or `web`

The script builds the target, restarts it (with `--no-deps` by default), runs a health check, and reports pass/fail. On failure, it logs the last 50 lines of the container and suggests recovery commands.

### E2E tests (local)

- **Run**: From repo root, `npm run test:e2e:bypass:mem` (or `npm run test:e2e:ci:bypass:mem` for JUnit output).
- **Setup**: Run `npm run onboard` or `npm run install:full` from repo root once per machine (installs npm deps, Playwright browsers, and on Linux prompts for system deps). If Chromium fails with missing shared libraries, run `npx playwright install-deps` manually (may need `sudo`).
- **Ports**: E2E uses `WEB_PORT` (default `3000` from `.env.local`) and `API_PORT` (default `4000`). Playwright only reclaims stale repo-owned web/API dev servers on those ports. If another process owns a port, the run fails and reports the owning PID/cwd/command; stop that process or override the ports.
- **Servers**: Playwright's `webServer` starts API and web automatically; no separate server script needed. Uses `PERSISTENCE_BACKEND=memory` and `AUTH_MODE=dev_bypass`.

### Integration tests with isolated host DB stack (CI-like local run)

- For macOS guest-VM Docker setup and troubleshooting, see [macos-vm-docker-setup.md](./macos-vm-docker-setup.md).

- **Run from repo root (explicit modes)**:
  ```bash
  npm run test:integration:full:host
  npm run test:integration:full:container
  ```
- `npm run test:integration:ci` is retired to avoid ambiguous host routing.
- Both explicit commands:
  - start `infra/docker/docker-compose.ci-integration.yml`
  - wait for Postgres/Redis readiness
  - poll host reachability for mapped DB/Redis ports to absorb startup races
  - run API integration tests with `RUN_POSTGRES_INTEGRATION=1`
  - tear down the CI stack automatically (`down -v`) unless `KEEP_CI_STACK=1`

- **Why host-port polling is required**:
  - Postgres/Redis can report ready from inside the containers before Docker host port forwarding is reachable from the caller shell.
  - This is common on Linux VM/containerized routing paths where `host.docker.internal` resolves, but mapped ports become reachable moments later.
  - Without polling, a single immediate probe can fail even though the stack becomes reachable shortly after.
  - Poll behavior is tunable with:
    - `CI_HOST_PORT_PROBE_ATTEMPTS` (default `30`)
    - `CI_HOST_PORT_PROBE_INTERVAL_SECONDS` (default `1`)

- **Isolation**:
  - CI stack uses non-conflicting ports by default:
    - Postgres: `15432`
    - Redis: `16379`
  - Existing stacks such as `twp-dev-postgres` (`5454`) and `twp-dev-redis` (`6363`) are untouched.

- **Mode-specific host routing**:
  - `test:integration:full:host`:
    - Intended for host shells, including guest VM shells that can access a Docker daemon.
    - Resolution order:
      1. `CI_TEST_HOST` (if set)
      2. `DOCKER_HOST` TCP host (if present)
      3. OS default gateway (`route` on Darwin, `ip route` on Linux)
      4. `localhost`
    - The script probes both DB/Redis ports and fails fast with `CI_TEST_HOST=<host-ip-or-dns>` guidance when no candidate is reachable.
    - Guest VM note: `localhost` usually points at the guest itself, not the physical host running Docker.
  - `test:integration:full:container`:
    - Intended for Linux/containerized shells.
    - Uses `host.docker.internal` and requires host-gateway mapping.
    - `docker run` example:
      ```bash
      --add-host=host.docker.internal:host-gateway
      ```
    - `docker compose` example:
      ```yaml
      extra_hosts:
        - "host.docker.internal:host-gateway"
      ```
    - The script fails fast if `host.docker.internal` is not resolvable.

- **Optional overrides**:
  - `CI_DB_PORT` (default `15432`)
  - `CI_REDIS_PORT` (default `16379`)
  - `CI_DB_NAME` (default `tw_portfolio_ci`)
  - `CI_COMPOSE_PROJECT` (default `twp-ci-integration`)
  - `CI_TEST_HOST` (host mode only; explicit Docker-host IP/DNS override)
  - `KEEP_CI_STACK=1` keeps containers running for debugging

---

## 3. Deployment Overview

For architecture diagrams, topology, port mappings, resource limits, and CI pipeline details, see:
- [System Architecture](../001-architecture/architecture.md) — deployment topology, environment tiers, port mapping, container resource limits
- [CI/CD](./ci-cd.md) — CI pipeline, Docker build validation, deploy workflows

### 3.1 Containers

| Environment | Stack prefix | Example containers | Compose file |
|-------------|--------------|--------------------|----|
| `local` | `twp-local` | `twp-local-web`, `twp-local-api`, `twp-local-postgres` | `docker-compose.local.yml` |
| `dev` | `twp-dev` | `twp-dev-web`, `twp-dev-api`, `twp-dev-postgres` | `docker-compose.dev.yml` |
| `production` | `twp-prod` | `twp-prod-web`, `twp-prod-api`, `twp-prod-postgres` | `docker-compose.prod.yml` |

`IMAGE_TAG` is set by the deploy script (see Deploy script options). App images are environment-specific (`twp-prod-*` or `twp-dev-*`), while Postgres, Redis, and cloudflared use fixed upstream images.

---

## 4. First-time Setup

1. **Clone the repo** on the QNAP (e.g. inside the `ubuntu-sshd` data mount):
   ```bash
   cd ~ && git clone <repo-url> tw-portfolio
   ```

2. **Create the environment file on the deploy host**:
   ```bash
   # Interactive setup (recommended — validates with Zod, prompts for secrets)
   npm run env:setup -- --target docker:prod
   chmod 600 infra/docker/.env.prod

   # For the dev lane:
   npm run env:setup -- --target docker:dev
   chmod 600 infra/docker/.env.dev
   ```
   All variables are documented in the unified `.env.example` at the repo root. The `env:setup` tool reads the schema, prompts for values, and auto-generates passwords where possible. See `.env.example` for `[context]` annotations indicating which vars apply to each deployment context.

3. **Configure the Cloudflare Tunnel** in the Cloudflare Zero Trust dashboard (see `infra/cloudflared/README.md`). Add both public hostnames for the web and API services.

4. **Set up Google OAuth credentials** (see [Section 4.0 Google OAuth Credentials](#40-google-oauth-credentials) below). Fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` in the env file.

5. **Deploy**:
   ```bash
   cd ~/tw-portfolio
   bash infra/scripts/deploy.sh --environment production
   ```

### 4.0 Google OAuth Credentials

Follow these steps once per environment to obtain OAuth credentials from Google Cloud Console.

1. **Create a GCP project** (or reuse an existing one). In [Google Cloud Console](https://console.cloud.google.com/), go to `APIs & Services` -> `OAuth consent screen`.
2. **Configure the consent screen**:
   - Choose **Internal** (Google Workspace only) or **External** (any Google account) as the user type.
   - Fill in the app name, support email, and developer contact.
   - Add any required scopes (for this app: `openid`, `email`, `profile`).
3. **Create an OAuth 2.0 client ID**:
   - Go to `APIs & Services` -> `Credentials` -> `Create credentials` -> `OAuth client ID`.
   - Choose **Web application** as the application type.
   - Add the authorized redirect URI for each environment:
     - Production: `https://<PUBLIC_DOMAIN_API>/auth/google/callback`
     - Dev: `https://<PUBLIC_DOMAIN_API>/auth/google/callback`
   - Click `Create` and copy the **Client ID** and **Client Secret**.
4. **Update the env file** with the values from step 3:
   ```bash
   # In infra/docker/.env.prod or infra/docker/.env.dev:
   GOOGLE_CLIENT_ID=<your-client-id>
   GOOGLE_CLIENT_SECRET=<your-client-secret>
   ```
5. **Generate a SESSION_SECRET**:
   ```bash
   openssl rand -hex 32
   ```
   Add the output as `SESSION_SECRET` in the env file.
6. **Reference**: [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)

`GOOGLE_REDIRECT_URI` and `APP_BASE_URL` are computed automatically in the compose files from `PUBLIC_DOMAIN_API` and `PUBLIC_DOMAIN_WEB`. Do not set them in the env file.

### 4.1 GitHub Actions Deploy Path via WARP

This repository's automated deploy path uses **Cloudflare WARP + private routing**, not `cloudflared access ssh`.

Why:

- Cloudflare documents client-side `cloudflared` for non-HTTP apps as a legacy path for SSH.
- Cloudflare documents that client-side `cloudflared` depends on WebSockets and notes that long-lived connections can close unexpectedly.
- Cloudflare recommends **WARP-to-Tunnel** or **Access for Infrastructure** for SSH instead.
- For GitHub Actions, the runner is a headless machine. WARP with a **service token** is the correct non-interactive authentication model.

In both deploy workflows, the runner:

1. Installs the WARP client
2. Enrolls into the Zero Trust organization using a **service token**
3. Routes traffic for the deploy host over WARP
4. SSHes to the deploy host by the environment-scoped `DEPLOY_HOST` value
5. Runs `infra/scripts/deploy.sh --environment <environment> --branch <branch> -t latest <sha>`

What this means in practice:

- the GitHub-hosted runner starts on the public internet and cannot normally reach your private deploy host
- WARP enrolls the runner into Cloudflare Zero Trust for the duration of the job
- once enrolled, Cloudflare routes only the allowed private destination traffic through WARP
- SSH then behaves like a normal private-network SSH connection to the deploy host
- the deploy script checks out the exact CI-tested commit SHA and builds app images tagged as `latest`

Expected deployment inputs for this flow:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `CF_TEAM_NAME`
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

### 4.2 Branch-to-Environment Mapping

This repository uses two deployment lanes:

- `dev` -> [`.github/workflows/deploy-dev.yml`](/home/ubuntu/github/tw-portfolio/.github/workflows/deploy-dev.yml) -> GitHub Environment `dev`
- `main` -> [`.github/workflows/deploy.yml`](/home/ubuntu/github/tw-portfolio/.github/workflows/deploy.yml) -> GitHub Environment `production`

Expected promotion flow:

1. Merge feature work into `dev`
2. `CI` runs on `dev`
3. Run the dev deploy workflow manually from GitHub Actions
4. Validate the dev environment
5. Merge `dev` into `main`
6. `CI` runs on `main`
7. Successful `CI` triggers the production deploy workflow automatically

### 4.3 Cloudflare Prerequisites for Automated Deploy

Before enabling the GitHub Actions deploy workflow, configure all of the following in Cloudflare Zero Trust.

The IPs, hostnames, and team names below are documentation examples only; use your GitHub Environment values for real deployments.

#### A. Tunnel and private route

The deploy target must be reachable through an existing Cloudflare Tunnel.
For instance:
- Deploy target: `192.0.2.10`
- SSH user: `ubuntu`

Terms:

- **Private route**: a Cloudflare route that tells WARP which internal IP or CIDR range should be sent through the tunnel instead of the public internet.
- **CIDR**: address and prefix notation used to describe either a single host or a range of IPs.

In Zero Trust:

1. Go to `Networks` -> `Routes` -> `CIDR`.
2. Add a route for the private deploy endpoint `192.0.2.10/32`
3. Attach that route to the same tunnel that is running on the QNAP side.
4. Confirm the QNAP-side tunnel connector is actually running and healthy before testing WARP from GitHub Actions.

CIDR examples:

- `192.0.2.10/32` means exactly one host
- if you need a small range such as `192.0.2.65` through `192.0.2.69`, one broad CIDR is `192.0.2.64/29`, which also includes `.64`, `.70`, and `.71`
- if you need to cover exactly `192.0.2.65` through `192.0.2.69`, use multiple routes:
  - `192.0.2.65/32`
  - `192.0.2.66/31`
  - `192.0.2.68/31`

Why:

- The GitHub runner must reach the deploy host as a **private network destination** over WARP.
- A public hostname mapped to `ssh://...:22` is not required for this WARP-based machine flow.

Verify from a trusted machine on the tunnel side before touching GitHub Actions:

```bash
nc -vz 192.0.2.10 22
```

If this fails locally from the tunnel side, WARP will not fix it.

What failure looks like:

- the route is missing or attached to the wrong tunnel: SSH from the runner times out
- the deploy host is down or SSH is not listening: `nc` fails locally and the GitHub job fails at the SSH verification step
- the tunnel is not running on the QNAP or is not advertising the route: WARP enrollment succeeds, but the runner still cannot reach the deploy host

Host-side validation checklist:

1. Confirm the Cloudflare Tunnel or connector process is running on the QNAP host.
2. Confirm the tunnel attached to the private route is the same tunnel running on that host.
3. Confirm the deploy host IP used by `DEPLOY_HOST` falls inside the advertised private route.
4. From the QNAP side, confirm SSH is listening on the deploy target:
   ```bash
   nc -vz 192.0.2.10 22
   ```
5. If the tunnel runs in Docker Compose, inspect the connector logs:
   ```bash
   docker logs twp-prod-cloudflared --tail 100
   docker logs twp-dev-cloudflared --tail 100
   ```
6. If the tunnel runs as a host service, inspect the local service logs instead:
   ```bash
   sudo journalctl -u cloudflared -n 100 --no-pager
   ```

Important:

- WARP on the GitHub runner is only the client-side on-ramp.
- You still need a Cloudflare Tunnel, WARP Connector, or equivalent private-network connector on the QNAP side.
- A valid service token alone does not make the private host reachable.

#### B. Service token for headless enrollment

Create a dedicated service token for the GitHub runner.

Term:

- **Service token**: a machine credential pair used by automation instead of an interactive browser login.

In Zero Trust:

1. Go to `Settings` -> `Service tokens`.
2. Create a service token for deploy automation.
3. Save the **Client ID** and **Client Secret**.

Why:

- Cloudflare documents service tokens as the non-interactive way to enroll devices.
- The GitHub Actions runner cannot complete a browser login or interactive identity-provider flow.

What failure looks like:

- wrong Client ID or Client Secret: WARP registration fails
- missing token policy permissions: WARP starts but never connects to the private route

#### C. Device enrollment permissions

Allow that service token to enroll devices into WARP.

Term:

- **Device enrollment permission**: the Zero Trust policy that decides which identities or service tokens may register a device into WARP.

In Zero Trust:

1. Create an Access policy with:
   - `Action`: `Service Auth`
   - `Include`: the deploy service token
2. Add that policy to `Settings` -> `WARP Client` -> `Device enrollment permissions`.

Why:

- Without a device enrollment rule, the runner will load the MDM file but fail registration.
- In our debugging, this class of problem showed up as missing registration or auth failures even though the daemon was running.

Validation:

- confirm the policy action is `Service Auth`
- confirm the service token you created is included in that policy
- confirm the policy is attached to WARP device enrollment permissions, not only to an unrelated Access application

#### D. Team name / organization

Set the WARP `organization` value to the **team name**, not the full domain.

Correct example:

```xml
<key>organization</key>
<string>example-team</string>
```

Incorrect example:

```xml
<key>organization</key>
<string>example-team.cloudflareaccess.com</string>
```

How to find it:

1. Open Zero Trust.
2. Go to `Settings`.
3. Find the team name / team domain section.

For a team domain like `example-team.cloudflareaccess.com`, the organization value is `example-team`.

Why:

- WARP expects the team name.
- Using the full Access domain causes registration/authentication failures even though the local MDM file is loaded successfully.

#### E. Device profile and Split Tunnels

For GitHub Actions, prefer a **narrow Include-mode** profile for just the deploy destination.

Terms:

- **Split Tunnels**: WARP rule set that decides which traffic goes through Cloudflare and which traffic goes directly to the internet.
- **Include mode**: only the listed IPs/domains go through WARP.
- **Exclude mode**: everything goes through WARP except the listed IPs/domains.

Recommended:

1. Go to `Team & Resources` -> `Devices` -> `Device profiles`.
2. Edit the profile used by the GitHub runner.
3. Set `Split Tunnels` to `Include IPs and domains`.
4. Include only the deploy destination or the narrowest private route that covers it.

Why:

- The runner only needs to send deploy traffic through WARP.
- This keeps the policy easy to reason about and avoids unintentionally tunneling unrelated runner traffic.

Common mistake:

- Leaving the default `Exclude IPs and domains` profile in place with your private range excluded.

Impact:

- Traffic to the deploy host bypasses WARP entirely.
- The runner times out on `ssh` to the deploy host.

This was a real failure mode during setup.

Validation:

- confirm the device profile used by the runner is the one you edited
- confirm the deploy host IP or CIDR appears in the Include list
- if you broaden the route later, keep `DEPLOY_HOST` inside the included CIDR range

### 4.4 GitHub Environment Secrets and Variables

Create two GitHub Environments:

- `dev`
- `production`

Store deploy values in the environment that uses them. Keep the secret names the same across environments, but set environment-specific values.

How to think about these values:

- use **secrets** for credentials or values you do not want printed in logs, such as SSH keys, host keys, service-token credentials, and usually the private deploy host
- use **variables** for stable non-secret configuration if your policy allows it
- all of these values feed the deploy workflow directly, so a typo here usually shows up as a failed WARP connection, failed SSH connection, or wrong remote path

| Name | Type | Value | Where to get it |
|---|---|---|---|
| `CF_ACCESS_CLIENT_ID` | Secret | Cloudflare Zero Trust service token Client ID | Cloudflare Zero Trust -> `Settings` -> `Service tokens` |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Cloudflare Zero Trust service token Client Secret | Cloudflare Zero Trust -> `Settings` -> `Service tokens` |
| `CF_TEAM_NAME` | Secret | Cloudflare Zero Trust team name only, for example `twp` | Cloudflare Zero Trust team/domain settings |
| `DEPLOY_SSH_KEY` | Secret | Private SSH deploy key in OpenSSH format | The private half of the deploy keypair generated for the remote deploy account |
| `DEPLOY_KNOWN_HOSTS` | Secret | Verified OpenSSH `known_hosts` entry for the deploy host | Generate with `ssh-keyscan -H 192.0.2.10` on a trusted machine, then verify the fingerprint out-of-band before storing |
| `DEPLOY_HOST` | Secret or variable | Private host/IP used for SSH over WARP, for example `192.0.2.10` | Your private deploy endpoint |
| `DEPLOY_USER` | Secret or variable | SSH user for remote deploy, for example `ubuntu` | The remote account used for deployment |
| `DEPLOY_PATH` | Secret or variable | Absolute repo path on the deploy host | The checked-out repo location on the remote machine |

Recommended:

- keep `DEPLOY_HOST` as a secret if you want it masked in logs
- use separate dev and production values whenever the targets differ
- scope all deploy values to the matching environment, not repository-wide secrets

Concrete examples:

- `DEPLOY_HOST=192.0.2.10`
- `DEPLOY_USER=ubuntu`
- `DEPLOY_PATH=/home/ubuntu/tw-portfolio`
- `CF_TEAM_NAME=example-team`

Relationship to the deploy flow:

- `DEPLOY_HOST` must match the host covered by the Cloudflare private route
- `DEPLOY_KNOWN_HOSTS` should be generated only after you have confirmed the final deploy host/IP
- `DEPLOY_PATH` must point to the repo checkout that contains `infra/scripts/deploy.sh`
- `DEPLOY_USER` must own or be allowed to execute the deploy script and access the repo directory

`DEPLOY_PATH` requirements:

- Use an absolute path such as `/home/ubuntu/tw-portfolio`.
- Do not use `~/tw-portfolio`.
- The workflow quotes `DEPLOY_PATH` inside the remote SSH command, so `~` is treated literally and does not expand to the deploy user's home directory.
- If `DEPLOY_PATH` uses `~`, the preflight step fails with exit code `1` because checks like `test -f '$DEPLOY_PATH/infra/scripts/deploy.sh'` cannot find the repo.

### 4.5 Prepare the SSH Target

Create a dedicated deploy key and authorize it on the deploy host.

#### A. Generate the deploy keypair

Run this on a trusted machine:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f github-actions-deploy
chmod 600 ./github-actions-deploy
```

This creates:

- `github-actions-deploy`: private key
- `github-actions-deploy.pub`: public key

Important:

- The private key must stay private and should only be stored in GitHub Secrets and trusted operator machines.
- OpenSSH will refuse to use a private key if permissions are too broad.

If you see:

```text
WARNING: UNPROTECTED PRIVATE KEY FILE!
Permissions 0644 for './github-actions-deploy' are too open.
```

fix it with:

```bash
chmod 600 ./github-actions-deploy
```

#### B. Install the public key on the deploy target

Authorize the public key for the deploy user on the deploy host:

```bash
ssh-copy-id -i github-actions-deploy.pub ubuntu@192.0.2.10
```

If `ssh-copy-id` is unavailable, append the key manually on the target:

```bash
mkdir -p /home/ubuntu/.ssh
chmod 700 /home/ubuntu/.ssh
cat github-actions-deploy.pub >> /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
chown -R ubuntu:ubuntu /home/ubuntu/.ssh
```

#### C. Verify the host is reachable and the key works

Before configuring GitHub Actions, verify three things from a machine that can reach the target on the LAN.

1. Port `22` is reachable:

```bash
nc -vz 192.0.2.10 22
```

2. The private key file permissions are correct:

```bash
ls -l ./github-actions-deploy
```

Expected mode is `-rw-------` or equivalent `600`.

3. SSH succeeds with the private key:

```bash
ssh -i ./github-actions-deploy ubuntu@192.0.2.10 'hostname && whoami'
```

Expected result:

- the remote hostname is printed
- the configured deploy user is printed

Why:

- WARP handles network reachability.
- SSH authentication is still your responsibility; this deploy path should use a dedicated deploy key for a dedicated deploy user.

#### D. Capture and verify the host key

On a trusted machine, collect the host key:

```bash
ssh-keyscan -H 192.0.2.10
```

Then verify the fingerprint directly on the server or through an already trusted channel before storing the final entry as `DEPLOY_KNOWN_HOSTS`.

#### E. Store the private key in GitHub Actions

Add the full contents of `github-actions-deploy` as the `DEPLOY_SSH_KEY` secret.

Do not store the `.pub` file in GitHub Secrets. Only the private key is needed by the workflow.

#### F. Troubleshooting SSH key verification

If `ssh` fails before prompting or connecting:

- verify `nc -vz 192.0.2.10 22` succeeds
- verify the target SSH daemon is listening on port `22`
- verify the public key is present in the deploy user's `authorized_keys`

If `ssh` says the private key is ignored:

- run `chmod 600 ./github-actions-deploy`

If `ssh` prompts for a password instead of using the key:

- the wrong public key was installed, or
- the key was installed for the wrong user, or
- `authorized_keys` / `.ssh` permissions are too open

### 4.6 Workflow Behavior

Both deploy workflows use the same hardened pattern:

1. Wait for the `CI` workflow to succeed on the matching branch
2. Install the WARP client on the GitHub-hosted runner
3. Write a root-only local WARP `mdm.xml` with:
   - `auth_client_id`
   - `auth_client_secret`
   - `organization`
   - `service_mode`
4. Start WARP and connect the runner
5. Install the SSH private key and pinned `known_hosts` entry
6. Verify the remote deploy script, compose file, and env file exist on the target host
7. Run:
   ```bash
   bash infra/scripts/deploy.sh --environment "$DEPLOY_ENVIRONMENT" --branch "$DEPLOY_BRANCH" -t "$DEPLOY_IMAGE_TAG" "$DEPLOY_SHA"
   ```

Current workflow triggers:

- Dev deploys are manual-only via `workflow_dispatch` in [`.github/workflows/deploy-dev.yml`](/home/ubuntu/github/tw-portfolio/.github/workflows/deploy-dev.yml).
- Production deploys run automatically after a successful `CI` run on `main` via [`.github/workflows/deploy.yml`](/home/ubuntu/github/tw-portfolio/.github/workflows/deploy.yml).

Why the workflow passes both branch and SHA:

- the deploy script validates that the target SHA is reachable from the branch being deployed
- the workflow always deploys the exact CI-tested commit while still tagging the resulting images as `latest`

Jargon explained:

- **workflow_run**: a GitHub Actions trigger that starts this deploy workflow after another workflow, in this case `CI`, completes
- **environment**: the GitHub Actions environment that scopes deploy secrets, variables, and optional approval gates
- **known_hosts**: the local SSH trust file used to verify the deploy host identity before the connection is allowed

### 4.7 Why `cloudflared access ssh` Is Not the Deploy Method

Do not use `cloudflared access ssh --hostname ...` with a service token for GitHub Actions deploys.

Reasons:

- Cloudflare documents client-side `cloudflared` SSH as **legacy**.
- Cloudflare states that `cloudflared` authentication relies on **WebSockets**.
- Cloudflare notes that automated services should use a **service token** where possible and recommends **WARP-to-Tunnel** in those situations.
- In practice, this path is easier to misconfigure because it mixes a user-style SSH flow with machine credentials.

What usually goes wrong with the legacy path:

- `websocket: bad handshake`
- service-token policy attached to a flow that expects browser/user login
- tunnel hostname mapped correctly, but auth method still mismatched

For human operators, evaluate **Access for Infrastructure** instead. Cloudflare recommends it for SSH because it adds finer-grained policies, short-lived certificates, and command logging.

---

## 5. Deployment Flow

Deploys use the shared `infra/scripts/deploy.sh` entrypoint with an explicit `--environment` flag. The script selects the matching compose file and env file (`docker-compose.prod.yml` + `.env.prod` for production, `docker-compose.dev.yml` + `.env.dev` for dev), checks out the target ref, builds app images, takes a pre-migration DB backup, runs migrations, brings up services, runs health checks, and on failure performs an automatic rollback.

### 5.1 Automated Dev Deploy

When a change is merged into `dev`:

1. GitHub runs `CI` on `dev`
2. an operator manually runs [`.github/workflows/deploy-dev.yml`](/home/ubuntu/github/tw-portfolio/.github/workflows/deploy-dev.yml)
3. the runner deploys the selected `dev` commit SHA to the `dev` environment
4. the remote deploy script builds images tagged `latest`

### 5.2 Automated Production Deploy

When validated changes are merged into `main`:

1. GitHub runs `CI` on `main`
2. a successful `CI` run triggers [`.github/workflows/deploy.yml`](/home/ubuntu/github/tw-portfolio/.github/workflows/deploy.yml)
3. the runner deploys the exact `main` commit SHA to the `production` environment
4. the remote deploy script builds images tagged `latest`

### 5.3 Manual Deploy

```bash
ssh ubuntu@192.0.2.10
cd ~/tw-portfolio
bash infra/scripts/deploy.sh --environment production
```

To deploy a specific CI-tested commit:

```bash
bash infra/scripts/deploy.sh --environment production <commit-sha>
```

### 5.4 Deploy Script Reference

**Usage:** `infra/scripts/deploy.sh [OPTIONS] [DEPLOY_SHA]`

| Option / argument | Description |
|-------------------|-------------|
| `-h`, `--help` | Show help and exit |
| `-e`, `--environment ENV` | Deploy `production` or `dev` (default: `production`) |
| `-b`, `--branch BRANCH` | Deploy from this branch (default: `main`; use `dev` for the dev lane) |
| `-s`, `--select-branch` | Interactively choose deploy branch from `git branch -a` (requires a TTY) |
| `-t`, `--image-tag TAG` | Use **TAG** for all app images in the selected environment (`twp-prod-*` or `twp-dev-*`). The GitHub Actions deploy workflows pass `latest` here. |
| `-f`, `--force` | Allow deploy with uncommitted changes (use with care; uncommitted changes may be lost on checkout) |
| `DEPLOY_SHA` | Optional. Commit SHA to deploy; must be reachable from the target branch. If omitted, script pulls latest from the branch. |

Option examples:

- deploy the latest commit from `main`:
  ```bash
  bash infra/scripts/deploy.sh --environment production
  ```
- deploy the latest commit from `dev`:
  ```bash
  bash infra/scripts/deploy.sh --environment dev --branch dev
  ```
- deploy a specific tested commit from `main`:
  ```bash
  bash infra/scripts/deploy.sh --environment production <commit-sha>
  ```
- deploy a specific tested commit from `dev` while keeping the runtime image tag as `latest`:
  ```bash
  bash infra/scripts/deploy.sh --environment dev --branch dev -t latest <commit-sha>
  ```

**Image tag behavior**

- **Default (no `--image-tag`)**: After checkout, the script sets `IMAGE_TAG=$(git rev-parse --short HEAD)`.
- **With `--image-tag latest`**: The script builds from the exact checked-out commit but tags all three app images as `latest`.
- **Recommended CI practice**: build an additional immutable sibling tag in CI or your image publication step so `latest` stays the runtime tag while each deploy remains traceable to a specific commit.

**Requirements**

- Docker and docker compose on PATH
- `infra/docker/.env.prod` present and configured for production deploys, or `infra/docker/.env.dev` for dev deploys
- Clean git working tree unless `--force` is used

**Exit codes:** `0` = success; `1` = validation or deployment failure (including after rollback).

---

## 6. Health Checks

- **Liveness**: `GET /health/live` → `{ "status": "ok" }`
- **Readiness**: `GET /health/ready` → `{ "status": "ready", "dependencies": { "postgres": true, "redis": true } }`

The deploy script waits up to 30s for the API and 20s for the web; if either fails, it triggers rollback.

---

## 7. Deploy logs and container logs

### Deploy logs

Each run writes a timestamped log and container snapshots under the state directory:

```
~/.local/state/tw-portfolio/<environment>/logs/deploy/
  deploy_YYYYMMDD_HHMMSS.log              # full deploy stdout+stderr
  deploy_YYYYMMDD_HHMMSS_containers/      # per-container log snapshots
    twp-<environment>-api.log
    twp-<environment>-web.log
    twp-<environment>-postgres.log
    ...
```

Logs older than 30 days are pruned automatically. Override the directory with `DEPLOY_LOG_DIR`, or set `TWP_STATE_DIR` as the base for both logs and backups.

### Checking container logs

```bash
docker logs twp-prod-api --tail 100 -f
docker logs twp-prod-web --tail 100 -f
docker logs twp-prod-postgres --tail 50
docker logs twp-prod-redis --tail 50
docker logs twp-prod-cloudflared --tail 50

docker logs twp-dev-api --tail 100 -f
docker logs twp-dev-web --tail 100 -f
docker logs twp-dev-postgres --tail 50
```

### 7.3 Maintenance Checklist

- Rotate `DEPLOY_SSH_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, and `CLOUDFLARE_TUNNEL_TOKEN` per environment; update the matching GitHub Environment and host env file together.
- Validate configuration before a manual deploy:
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.prod config >/dev/null
  docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev config >/dev/null
  ```
- Verify the active stack on a host:
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.prod ps
  docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev ps
  ```
- Clean old app images carefully by environment prefix only:
  ```bash
  docker images | grep '^twp-prod-'
  docker images | grep '^twp-dev-'
  ```

---

## 8. Troubleshooting

### 8.1 API Requests Fail with `net::ERR_NAME_NOT_RESOLVED` (for example `/settings` or `/portfolio/holdings`)

The browser cannot resolve the API hostname. This is a **DNS / Cloudflare Tunnel** configuration issue, not an app bug.

1. **Confirm both tunnel hostnames**  
   In **Cloudflare Zero Trust** -> **Networks** -> **Tunnels** -> your tunnel -> **Public Hostname**:
   - `twp-web.example.com` -> `http://twp-prod-web:3000`
   - `twp-api.example.com` -> `http://twp-prod-api:4000`
   If the API hostname is missing, add it (same tunnel). Cloudflare will create the CNAME for the API subdomain.

2. **Verify DNS from the same network as users**  
   From a machine using the same DNS as the browser (e.g. your laptop):
   ```bash
   getent hosts twp-api.example.com
   # or: nslookup twp-api.example.com
   ```
   If it does not resolve, fix in step 1 and allow TTL/propagation.

3. **Ensure the zone is on Cloudflare**  
   The domain hosting `twp-api.example.com` must be in Cloudflare so the tunnel can create CNAMEs. If DNS for that zone is elsewhere, create a CNAME for `twp-api.example.com` pointing to your tunnel’s address (for example `<tunnel-id>.cfargotunnel.com`), as shown in the tunnel’s Public Hostname list.

After fixing DNS, no redeploy is needed; the web app already uses the correct API URL.

### 8.2 API Requests Show Response Status 0 (CORS)

If the request to the API hostname shows **status 0** in DevTools and the page origin is the web hostname, the browser is likely blocking the response due to CORS (missing or wrong `Access-Control-Allow-Origin`).

1. **Check the API’s allowed origin** on the server:
   ```bash
   docker exec twp-prod-api printenv ALLOWED_ORIGINS
   ```
   It must be exactly `https://twp-web.example.com` (no trailing slash). It is set from `PUBLIC_DOMAIN_WEB` in `docker-compose.prod.yml`.

2. **Ensure `.env.prod` has** `PUBLIC_DOMAIN_WEB=twp-web.example.com` (no trailing slash), then redeploy so the API container gets the correct env.

3. **Browser console**: Look for a CORS error (e.g. “blocked by CORS policy: No 'Access-Control-Allow-Origin' header”).

4. **Quick test**: Open `https://twp-api.example.com/health/live` in a new tab. If it returns JSON, the API and DNS are fine and the issue is CORS for the web origin.

### 8.3 GitHub Actions deploy fails with `No route to host`

This usually means the runner enrolled into WARP but Cloudflare still does not have a working private-network path to the deploy target.

Check these in order:

1. Confirm the QNAP-side Cloudflare Tunnel or connector is running.
2. Confirm the private route covering `DEPLOY_HOST` is attached to that tunnel.
3. Confirm the GitHub Environment `DEPLOY_HOST` value is the private IP or hostname covered by that route.
4. Confirm the WARP device profile for the runner includes the deploy host or CIDR in Split Tunnels.
5. Confirm the service token is allowed in `Settings -> WARP Client -> Device enrollment permissions`.

Useful commands:

```bash
warp-cli --accept-tos status
sudo systemctl status warp-svc --no-pager
nc -vz 192.0.2.10 22
docker logs twp-prod-cloudflared --tail 100
docker logs twp-dev-cloudflared --tail 100
```

Important:

- WARP client authentication on the runner does not replace the need for a tunnel or private-network connector on the QNAP side.
- If the tunnel is missing, stopped, or not advertising the right route, GitHub Actions can authenticate to WARP and still fail to reach SSH.

### 8.4 GitHub Actions deploy fails with exit code `1` during SSH preflight

If the workflow reaches SSH successfully but exits with code `1` during `Verify SSH connectivity and remote files`, the remote command ran and one of the preflight checks failed.

The workflow checks all of the following on the remote host:

- `infra/scripts/deploy.sh` exists under `DEPLOY_PATH`
- the environment-specific compose file exists
- the environment-specific env file exists
- `docker compose` is available for the deploy user

Common causes:

- `DEPLOY_PATH` is wrong
- `DEPLOY_PATH` uses `~` instead of an absolute path
- `infra/docker/.env.dev` or `infra/docker/.env.prod` has not been created on the remote host
- the deploy user cannot run `docker compose`

Useful remote command:

```bash
ssh "$DEPLOY_USER@$DEPLOY_HOST" "
set -x
ls -l '$DEPLOY_PATH/infra/scripts/deploy.sh'
ls -l '$DEPLOY_PATH/infra/docker/docker-compose.dev.yml'
ls -l '$DEPLOY_PATH/infra/docker/.env.dev'
docker compose version
"
```

If you are debugging production, replace the dev file names with the production equivalents.

### 8.5 Local Docker Deployment

#### SSH tunnel for Docker-hosted API

If the API runs inside a Docker container (e.g. via `docker-compose.local.yml`), the browser on the host cannot reach the container's internal port directly. Create an SSH tunnel forwarding the API port to the Docker host IP:

```bash
ssh -L 4300:192.168.64.1:4300 user@docker-host
```

Replace `192.168.64.1` with your Docker host IP (varies by environment — check `docker network inspect bridge` or your VM's network config).

#### SESSION_COOKIE_NAME

Do not use the `__Host-` prefix (e.g. `__Host-g_auth_session`) when running over HTTP. The `__Host-` prefix requires the `Secure` flag, which browsers reject over plain HTTP. Use `g_auth_session` instead.

#### NODE_ENV behavior matrix

| Value | Cookie `Secure` flag | Port validation | `/__e2e/oauth-session` | `/__e2e/reset` |
|-------|---------------------|-----------------|----------------------|----------------|
| `production` | Set — browser silently drops cookie over HTTP | Standard | Unavailable | Blocked |
| `development` | Not set | Rejects mismatched container/host ports (4000 vs 4300) | Available | Available |
| `test` (recommended) | Not set | Relaxed — no port mismatch errors | Available | Blocked |

`test` is recommended for local Docker because it avoids both the `Secure` cookie problem (production) and the port validation mismatch (development), while keeping the `/__e2e/oauth-session` endpoint available for debugging.

#### NEXT_PUBLIC_AUTH_MODE

`NEXT_PUBLIC_AUTH_MODE` is baked into the Next.js client bundle at build time via the Dockerfile `ARG`/`ENV`, but the multi-stage build does **not** carry `ARG`/`ENV` values from the build stage to the runtime stage. Server-side code (`proxy.ts`, `auth.ts`) reads `process.env.NEXT_PUBLIC_AUTH_MODE` at runtime, so the variable must also be set in the compose `environment` block. All three compose files set it: local uses `${AUTH_MODE:-oauth}` (matching the build arg), dev and prod hardcode `oauth`.

To change auth mode for client-side JavaScript, update the `AUTH_MODE` variable (which feeds the build arg) and rebuild the web image.

#### SERVER_API_BASE_URL

Server-side Next.js route handlers (e.g. `app/api/profile/route.ts`) run inside the Docker network and need to reach the API via the container hostname, not the host-published port or the external Cloudflare URL. Without this override, server-side fetches would hairpin through the public internet (web → Cloudflare edge → tunnel → API), adding latency and a fragile external dependency.

`SERVER_API_BASE_URL` is set in all three compose files (`http://twp-{env}-api:4000`) and should not be added to the env files — it is a container-network-specific value.

---

## 9. Rollback

### 9.1 Automatic rollback

If the API or web health check fails after deploy, the script automatically rolls back: it restores the previous git branch and SHA, restores the pre-migration database backup, rebuilds images, and restarts containers. The rollback block uses `set +e` so partial failures do not abort the recovery.

### 9.2 Manual rollback

To redeploy a known-good commit:

```bash
cd ~/tw-portfolio
git log --oneline -5          # find the commit to roll back to
bash infra/scripts/deploy.sh --environment production <commit-sha>
bash infra/scripts/deploy.sh --environment dev --branch dev <commit-sha>
```

The script will checkout that SHA (if reachable from the current branch), use its short SHA as the image tag, and run the full deploy flow. To use a specific tag string for the images instead of the short SHA, pass `--image-tag <tag>` (the repo is still checked out and built from the current ref; only the tag label changes).

**Edge case**: Manual rollback does not re-run migrations in reverse. If the failed deploy applied a migration, the automatic rollback restores the DB from the pre-migration backup. If automatic restore failed, restore manually from backups (see Database backup and Migration rollback below).

### 9.3 Database migration rollback

Migrations are **not** automatically reversed by a code rollback. The deploy script takes a Postgres backup before every migration and restores it during automatic rollback. If automatic restore fails, restore manually from the state backup directory:

```bash
gunzip -c ~/.local/state/tw-portfolio/production/backups/<latest>.sql.gz | docker exec -i twp-prod-postgres psql -U twp -d tw_portfolio
gunzip -c ~/.local/state/tw-portfolio/dev/backups/<latest>.sql.gz | docker exec -i twp-dev-postgres psql -U twp -d tw_portfolio
```

Replace `<latest>` with the appropriate backup filename (e.g. the pre-migration backup).

### 9.4 Migration runner and contract

Migrations run in a dedicated image (`db/Dockerfile.migrate`) that bakes SQL files in at build time. The deploy script uses `docker compose run --build --rm` to force a fresh image build before running, preventing Docker layer cache from serving a stale migrate image that is missing new migration files. Both the API startup path and the container runner now use `schema_migrations` as the source of truth and acquire the same advisory lock before applying pending work.

After the migrate container exits successfully, the deploy script runs a **post-migration verification**: it queries `schema_migrations` to confirm the newest numbered migration file is recorded. If verification fails, the deploy logs the current migration state and triggers rollback.

Fresh databases bootstrap from `db/migrations/baseline_current_schema.sql`, then mark the superseded numbered files listed in `db/migrations/manifest.env` as applied. Existing databases continue through the numbered `db/migrations/[0-9][0-9][0-9]_*.sql` files in lexical order, with each file inserted into `schema_migrations` after it succeeds.

The dedicated runner refuses to guess when the public schema already has tables but `schema_migrations` is empty. In that state, recover the ledger explicitly or restore from backup before re-running migrations.

Current support policy for numbered migrations:
- Fresh empty databases do not need the numbered `001` through `010` files individually; the baseline schema supersedes them.
- Existing databases created before the baseline flow still require the numbered files as the supported upgrade path.
- Do not delete or rewrite numbered migrations unless the team explicitly drops support for upgrading legacy databases from those states.

Current numbered migration inventory:
- `001_init.sql`: original base schema with users, fee profiles, accounts, transactions, lots, and recompute tables.
- `002_cost_basis_weighted_average.sql`: normalizes all users to `WEIGHTED_AVERAGE` and enforces the new invariant.
- `003_accounting_core_schema.sql`: introduces the canonical accounting tables such as `trade_events`, dividends, cash ledger, reconciliation, and daily snapshots.
- `004_trade_order_and_lot_allocations.sql`: adds trade booking order, lot opening order, and `lot_allocations`, with backfills for legacy rows.
- `005_booking_order_uniqueness.sql`: repairs duplicate booking and lot sequences, then adds uniqueness indexes.
- `006_dividend_schema_alignment.sql`: aligns dividend ledger structure, adds typed dividend deductions, and retires older deduction columns.
- `007_fee_profile_precision_and_dividend_currency.sql`: adds precise fee-profile fields and `cash_dividend_currency`.
- `008_commission_discount_percent.sql`: derives `commission_discount_percent` from legacy basis-point data.
- `009_retire_twd_ntd_fields.sql`: renames `_ntd` amount fields to amount-plus-currency names and adds currency constraints.
- `010_trade_snapshot_recompute_normalization.sql`: introduces `trade_fee_policy_snapshots`, migrates recompute references, backfills dividend cash ledger entries, and drops retired legacy structures such as `transactions`.
- `014_user_identity_and_demo.sql`: adds `display_name`, `is_demo`, `demo_expires_at`, `created_at`, `updated_at`, `deactivated_at`, `deleted_at` to `users`; creates `user_external_identities`; makes `users.email` nullable with partial unique index.
- `015_cookie_domain_and_session.sql`: adds `COOKIE_DOMAIN` support to session cookie configuration; adjusts demo session cookie handling for cross-subdomain sharing.
- `016_transaction_mutations.sql`: upgrades FK constraints on `cash_ledger_entries.related_trade_event_id`, `lot_allocations.trade_event_id`, `trade_events.reversal_of_trade_event_id`, and `recompute_job_items.trade_event_id` to `ON DELETE CASCADE`; adds `fees_source TEXT NOT NULL DEFAULT 'CALCULATED'` column to `trade_events`.

---

## 10. Database backup

**Script (recommended):**

```bash
bash infra/scripts/backup-postgres.sh --environment production
bash infra/scripts/backup-postgres.sh --environment dev
```

Backups are written to `~/.local/state/tw-portfolio/<environment>/backups/` (or `BACKUP_DIR` / `TWP_STATE_DIR` if set). Old backups are pruned per `RETAIN_DAYS` (default 30).

**Manual backup:**

```bash
docker exec twp-prod-postgres pg_dump -U twp tw_portfolio | gzip > ~/.local/state/tw-portfolio/production/backups/tw_portfolio_$(date +%Y%m%d_%H%M%S).sql.gz
docker exec twp-dev-postgres pg_dump -U twp tw_portfolio | gzip > ~/.local/state/tw-portfolio/dev/backups/tw_portfolio_$(date +%Y%m%d_%H%M%S).sql.gz
```

---

## 11. Expected downtime

Container recreation causes about **10–30 seconds** of downtime while `docker compose up -d` recreates changed containers and the Cloudflare Tunnel re-establishes. This is acceptable for the home-lab deployment.

---

## 12. Security assumptions

- **External TLS**: All public traffic is encrypted via the Cloudflare Tunnel. TLS terminates at Cloudflare’s edge; the tunnel uses an authenticated, encrypted connection to the `cloudflared` container.
- **Internal traffic**: Communication between containers on the `twp-prod-net` and `twp-dev-net` Docker bridges (web -> api, api -> postgres, api -> redis) uses plaintext. This is acceptable because each bridge is isolated to the Docker host and not routable from the LAN.
- **Postgres**: No `sslmode`; relies on Docker network isolation.
- **Redis**: Password-authenticated, no TLS; relies on Docker network isolation.
- If the deployment moves to a multi-host setup, internal TLS must be introduced.

---

## 13. Secrets Management

### 13.1 File permissions

`.env.prod` and `.env.dev` must be `chmod 600` (owner-only read/write). This is enforced by the first-time setup `chmod 600` step and should be re-verified after any manual copy.

### 13.2 Never commit real env files

`.env.prod` and `.env.dev` are gitignored. Only `.env.*.example` files with placeholders are committed to the repository. Never commit or share real credentials.

### 13.3 Secret rotation

| Secret | How to rotate |
|---|---|
| `SESSION_SECRET` | Generate new value with `openssl rand -hex 32`, update env file, redeploy. Active sessions are invalidated; users must re-login. |
| `POSTGRES_PASSWORD` | Update in env file AND recreate the Postgres container with the new password. |
| `REDIS_PASSWORD` | Update in env file AND recreate the Redis container with the new password. |
| `GOOGLE_CLIENT_SECRET` | Rotate in Google Cloud Console (`APIs & Services` -> `Credentials`), update env file, redeploy. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Rotate in the Cloudflare dashboard, update env file, redeploy `cloudflared`. |

### 13.4 Backup exclusion

The database backup script stores Postgres dumps only. Do not include `.env.*` files in any backup artifact. Env files contain secrets and must not leave the deployment host.

### 13.5 GitHub Actions secrets

Deploy credentials (SSH keys, CF tokens, WARP service tokens) are scoped to GitHub Environment secrets, never stored in the repository. See Section 4.4 for the full list.

### 13.6 Best practices for home lab

- Use a dedicated deploy user with minimal permissions (deploy script execution and Docker access only).
- Restrict SSH access to key-based auth only; disable password authentication.
- Consider encrypting env files at rest if the host filesystem supports it.
- Docker secrets (`docker secret create`) are an alternative for Swarm mode. For Compose, env files with `chmod 600` permissions are standard practice.

---

## 14. App behavior (reference)

The following sections describe product behavior for support and verification. They are not part of the deployment procedure.

### 14.1 Page-load progress bar

- The thin bar at the very top during **initial page load** is a frontend-only visual indicator.
- It is rendered by the web app’s root layout (`apps/web/app/layout.tsx`) via `LoadingProgressBar` (`apps/web/components/ui/LoadingProgressBar.tsx`) and styled in `apps/web/app/globals.css` (`.loading-progress`, `.loading-progress__bar`).
- The bar shows briefly on first load with a minimum visible duration, advances quickly then creeps toward ~80% on slower loads, and jumps to 100% and hides when the frontend considers the page ready. It does **not** track client-side route transitions.
- Accessibility: respects `prefers-reduced-motion`; uses `aria-live="off"` to avoid spamming screen readers.
- **Operational note**: This bar reflects perceived performance, not backend health; use `/health/live` and `/health/ready` for service status. If the bar is missing or wrong, verify the web container serves the expected layout, `globals.css` (including `.loading-progress` and theme tokens) is loaded, and no overlay is masking the bar (it uses `z-index: 1000`).

### 14.2 Settings drawer

- Open settings from the top-right avatar. Drawer URL state is `/?drawer=settings` for direct linking.
- Tabs: **General** and **Fee Profiles**. **Save Settings** persists locale, poll interval, weighted-average cost basis, and fee profiles atomically via `/settings/full`. Fee profiles support account fallback and per-security overrides; new profile IDs are system-generated (UUID). **Discard Changes** reverts unsaved edits without closing the drawer. Closing with unsaved edits shows a warning.
- In **Fee Profiles**, **Commission Currency** is a dropdown. The UI ships with common options and also preserves already-saved currency codes present in the loaded profile set.
- In **Record Transaction**, the **Currency** field is display-only. It is disabled in the form and is derived from the effective fee profile for the selected account and symbol. Change it from **Settings > Fee Profiles**, not from the transaction card.

### 14.3 Localization

- UI locales: `en` and `zh-TW`. After saving locale, visible wording (including settings tabs and dialogs) switches to the selected language. If language appears stale, reopen the settings drawer or reload and verify the `/settings` response.

### 14.4 Tooltips

- Settings terms and key financial terms on the dashboard/forms have hover/focus tooltips. Weighted-average cost basis includes detailed explanatory content in settings. Tooltips are keyboard-accessible via the info icon triggers.

---

## 15. KZO-143 deploy notes

### Session cookie format change

KZO-143 changes the OAuth session cookie from 2-part (`{userId}.{hmac}`) to 3-part (`{userId}.{sessionVersion}.{hmac}`). On deploy, any user with an active OAuth session will receive a 401 on their next API request because the old 2-part cookie fails the new signature check. The web proxy redirects them to `/login` — a one-time re-login restores the session.

**Demo sessions are unaffected** — they remain 2-part (`demo:{userId}.{hmac}`).

**No data migration required.** The `030_kzo143_auth_foundations.sql` migration adds columns, creates tables, and backfills emails to lowercase. It does not modify or move user data.

**Rollback impact:** Rolling back the API image to pre-KZO-143 means old code sees 3-part cookies and rejects them → another forced re-login. No data corruption in either direction.

### New env var: `INITIAL_ADMIN_EMAIL`

Optional. When set, the startup routine promotes the matching user to admin. On first sign-in, the email bypasses the invite-gate. See [Auth and Session — INITIAL_ADMIN_EMAIL](../001-architecture/auth-and-session.md#initial_admin_email-bootstrap).

If the deployment is a fresh install with no existing users, set this to the admin's Google email before first boot.

### New CLI commands

- `npm run admin:promote -- email@example.com` — promotes an existing user to admin (requires the user to have signed in at least once)
- `npm run admin:bootstrap-invite -- email@example.com admin` — seeds an invite directly in DB, bypassing HTTP auth (escape hatch for fresh deployments when `INITIAL_ADMIN_EMAIL` is not set)

### Migration pre-backfill guard

Migration `030_kzo143_auth_foundations.sql` lowercases all `users.email` values. If case-insensitive duplicates exist (e.g. `User@X.com` and `user@x.com`), the migration **aborts with a listing of the duplicates**. Resolve manually (delete or merge the duplicate) before re-running.

---

## 16. KZO-147 deploy notes

### Migration

`033_kzo147_anonymous_share_tokens.sql` adds:
- `anonymous_share_tokens` table with `ON DELETE CASCADE` on `owner_user_id`
- `ALTER TABLE audit_log` to extend `audit_log_action_check` with `share_token_created` and `share_token_revoked`

Idempotent (`CREATE TABLE IF NOT EXISTS` + a `DO $$ ... END $$` block that drops and re-adds the CHECK constraint). Safe to re-run. No backfill, no data rewrite.

**Rollback impact.** Older API images do not emit the new audit actions, so the updated CHECK is a superset of the old one — rollback needs no schema rollback. If the table is later dropped, all anonymous share tokens are lost (tokens are plaintext and cannot be rehydrated).

### New env vars

Both optional with sensible defaults:
- `ANONYMOUS_SHARE_RATE_LIMIT_MAX` (default `30`) — per-IP sliding window count
- `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (default `300_000` = 5 min)

Keep the defaults unless a specific abuse pattern is observed; `Retry-After` is emitted as `windowMs / 1000`.

### Plaintext token storage

Anonymous share tokens are stored **plaintext** in `anonymous_share_tokens.token`. This is intentional — the owner UI needs to re-display the full URL from the list page, which rules out hashing. Treat this column as sensitive:

- DB access = token access. Anyone with read access to `anonymous_share_tokens` can impersonate the public URL on any active row.
- Backup files containing this table should be encrypted at rest.
- `pg_dump` output should not be shared casually.

Request logs are redacted server-side (Fastify `serializers.req` rewrites the 22-char token segment to `[REDACTED]`). Upstream proxies (CDN, Cloudflare, reverse proxy) and browser DevTools will still show the plaintext token in URL access logs.

### Re-enable-owner auto-resumes tokens

Disabling a user (`POST /admin/users/:id/disable`) does **not** revoke their anonymous share tokens. The tokens remain in the table with their original `expires_at`, but the public route returns 404 because step 4 of the handler rejects soft-deleted / deactivated owners.

Re-enabling the same user (`POST /admin/users/:id/enable`) transparently resurrects their tokens — they begin resolving again at `/share/{token}` without further action.

If a deployment needs "disable also revokes tokens" semantics, add a revocation pass to `disableUser` in the admin service. Not a default because it changes the contract for short-lived disables (e.g. investigating a suspected-compromised account).

### Rate-limit bucket memory growth

`anonymousShareRateBuckets` (in-process `Map<ip, timestamps[]>`) grows with the set of distinct IPs that have ever hit `/share/:token`. Same class as `inviteStatusBuckets` (KZO-143). Not bounded in this release; flagged for a cross-cutting eviction follow-up. For a single-instance deployment this is only a concern if the public URL is exposed to scrapers at scale.

### Operational checks

- If a user reports "my public link stopped working", check (in order): `revoked_at`, `expires_at`, owner `deactivated_at` / `deleted_at`, and `/admin/audit-log` for matching `share_token_revoked`.
- Cap breach: `SELECT COUNT(*) FROM anonymous_share_tokens WHERE owner_user_id = $1 AND revoked_at IS NULL AND expires_at > NOW();` should never exceed 20 — the advisory lock prevents concurrent creates from racing past the cap.
- Retention cleanup: revoked/expired rows older than 30 days are filtered from the owner list but remain in the table indefinitely. A long-tail cleanup cron is a future candidate; no immediate pressure.
