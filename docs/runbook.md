# Deployment Guide

This document is the single source of truth for deploying and operating the **tw-portfolio** stack: local development, production on the QNAP home lab, and related runbooks. It is written for operators and developers who deploy or troubleshoot the stack.

---

## 1. Prerequisites

- **Docker** and **Docker Compose** on the deployment host
- **Git** (for production: repo cloned on the deploy host)
- **Production**: Configured env file at `infra/docker/.env.prod` (see First-time setup)
- **Production**: Clean git working tree for deploy (or use `--force`; see Deploy script options)

---

## 2. Local Development

### Start services

- Choose one local mode:
- Memory mode (default): set `PERSISTENCE_BACKEND=memory`, then run `npm run dev`.
- Postgres + local Docker mode: set `PERSISTENCE_BACKEND=postgres`, run `docker compose -f infra/docker/docker-compose.yml up -d`, then run `npm run dev`.
- Postgres + external services mode: set `PERSISTENCE_BACKEND=postgres` with external `DB_URL`/`REDIS_URL`, then run `npm run dev`.
- `infra/docker/docker-compose.yml` is local fallback Postgres/Redis and is not required for memory mode or external URL mode.

Tip: When `next dev` can't bind to `WEB_PORT` (default `3000` from `.env.example`), a previous instance likely still owns the port. Identify the orphaned process with `ps -ef | grep -i "next dev"` and stop it via `kill <pid>` or `pkill -f "next dev -p"`, then rerun `npm run dev -w apps/web`.
`scripts/kill-next.sh` clears the web and API ports from `.env`. Run `./scripts/kill-next.sh` to target both, `./scripts/kill-next.sh web`/`api` for a specific service, or supply any port number directly.


### Build model

- Workspace libraries (`@tw-portfolio/domain`, `@tw-portfolio/shared-types`) are **not** built during `npm install` / `npm ci`. `npm run onboard` now builds them before handing you the lockfile results, but you still need to run `npm run build -w libs/domain -w libs/shared-types` if you skip onboarding or if you edit those packages after the initial setup.
- Local: `npm run dev` (from repo root) starts the API and web dev servers. Onboarding already builds the workspace libs and `npm run dev` will rebuild them when the outputs are missing, but rerun `npm run build -w libs/domain -w libs/shared-types` after editing those packages or if you skipped onboarding.
- CI: `npm ci` then explicit `npm run build -w ...` steps for domain/shared-types/api (and web typecheck).
- Production: Dockerfiles run `npm ci` then explicit `npm run build -w ...` in the same order; deploy builds images from the checked-out ref.

### Required env

- `WEB_PORT`, `API_PORT`, `DB_PORT`, `REDIS_PORT`
- `AUTH_MODE`, `PERSISTENCE_BACKEND`
- `DB_URL`, `REDIS_URL` (required for external Postgres/Redis mode; optional in local Postgres mode)
- `ALLOWED_ORIGINS` (comma-separated CORS allowlist)
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_MUTATIONS`

What these settings mean:

- `WEB_PORT`: local port where the Next.js web app listens. Example: `3000`.
- `API_PORT`: local port where the API server listens. Example: `4000`.
- `DB_PORT`: local compose Postgres mapped port used when `DB_URL` is unset. Example: `5432`.
- `REDIS_PORT`: local compose Redis mapped port used when `REDIS_URL` is unset. Example: `6379`.
- `AUTH_MODE`: authentication strategy. `dev_bypass` skips real auth for local development; `oauth` expects an authenticated user id header from the web app or a fronting auth layer.
- `PERSISTENCE_BACKEND`: storage mode used by the API. Example values: `memory` for local tests, `postgres` for normal development and production-like runs.
- `DB_URL`: Postgres connection string used by the API. Local mode example: `postgres://app:app@localhost:5432/tw_portfolio`. External mode example: `postgres://<user>:<password>@192.168.2.10:5454/tw_portfolio`.
- `REDIS_URL`: Redis connection string used by the API. Local mode example: `redis://localhost:6379`. External mode example: `redis://:<password>@192.168.2.10:6363`.
- `ALLOWED_ORIGINS`: comma-separated list of browser origins allowed to call the API. Example: `http://localhost:3000,https://twp-web.example.com`.
- `RATE_LIMIT_WINDOW_MS`: rolling time window for mutation rate limiting, in milliseconds. Example: `60000` for a one-minute window.
- `RATE_LIMIT_MAX_MUTATIONS`: maximum number of allowed write operations within the rate-limit window. Example: `60`.

### Notes

- Use `AUTH_MODE=dev_bypass` for local development only.
- For production-like runs use `AUTH_MODE=oauth`. With `AUTH_MODE=oauth`, the API expects the header `x-authenticated-user-id`. The web app sends it when `NEXT_PUBLIC_AUTH_USER_ID` is set (production: set `AUTH_USER_ID` in `infra/docker/.env.prod`; it is passed as a build arg, so the web image must be rebuilt after changing it). If `AUTH_USER_ID` is blank with `AUTH_MODE=oauth`, the web app sends no auth header and calls like `GET /settings` return 401.
- With `AUTH_USER_ID` / `NEXT_PUBLIC_AUTH_USER_ID`, the user id is embedded in the client bundle and is visible to anyone who can load the web app. This is acceptable for the intended single-user home-lab deployment; do not reuse for multi-tenant or untrusted-user environments.
- Recompute history is explicit and audited via preview/confirm APIs.
- For local tests without DB/Redis, set `PERSISTENCE_BACKEND=memory`.
- For external Postgres/Redis mode, keep `PERSISTENCE_BACKEND=postgres` and set external `DB_URL`/`REDIS_URL`; do not start local compose DB/Redis unless needed for fallback.

### E2E tests (local)

- **Run**: From repo root, `npm run test:e2e` (or `npm run test:e2e:ci` for JUnit output).
- **Setup**: Run `npm run onboard` or `npm run install:full` from repo root once per machine (installs npm deps, Playwright browsers, and on Linux prompts for system deps). If Chromium fails with missing shared libraries, run `npx playwright install-deps` manually (may need `sudo`).
- **Ports**: E2E uses `WEB_PORT` (default `3000` from `.env.example`) and `API_PORT` (default `4000`). Playwright only reclaims stale repo-owned web/API dev servers on those ports. If another process owns a port, the run fails and reports the owning PID/cwd/command; stop that process or override the ports.
- **Servers**: Playwright's `webServer` starts API and web automatically; no separate server script needed. Uses `PERSISTENCE_BACKEND=memory` and `AUTH_MODE=dev_bypass`.

### Integration tests with isolated host DB stack (CI-like local run)

- For macOS guest-VM Docker setup and troubleshooting, see [macos-vm-docker-setup.md](./macos-vm-docker-setup.md).

- **Run from repo root (explicit modes)**:
  ```bash
  npm run test:integration:ci:host
  npm run test:integration:ci:container
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
  - `test:integration:ci:host`:
    - Intended for host shells, including guest VM shells that can access a Docker daemon.
    - Resolution order:
      1. `CI_TEST_HOST` (if set)
      2. `DOCKER_HOST` TCP host (if present)
      3. OS default gateway (`route` on Darwin, `ip route` on Linux)
      4. `localhost`
    - The script probes both DB/Redis ports and fails fast with `CI_TEST_HOST=<host-ip-or-dns>` guidance when no candidate is reachable.
    - Guest VM note: `localhost` usually points at the guest itself, not the physical host running Docker.
  - `test:integration:ci:container`:
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

### 3.1 Architecture

- **Deployment host**: QNAP-based home lab running the deploy target and app containers
- **Deploy transport**: GitHub Actions runner -> Cloudflare WARP -> private SSH target
- **App network**: Docker bridge `twp-prod-net`
- **External access**: Cloudflare Tunnel terminates public traffic and forwards to the web and API containers

Glossary:

- **Cloudflare WARP**: the client installed on the GitHub-hosted runner so the runner can securely reach private network destinations during the workflow.
- **Cloudflare Tunnel**: the outbound tunnel running on your infrastructure that publishes selected internal services to Cloudflare without opening inbound firewall ports.
- **Private SSH target**: the internal machine or container that accepts SSH from the runner once WARP routing is active.
- **Docker bridge**: the private Docker network that lets the app containers talk to each other on the deployment host.

Keep concrete private IPs, Cloudflare tunnel IDs, and public hostnames out of this document. Store them in the appropriate GitHub Environment secrets or variables instead.

### 3.2 Host resource budget

The QNAP NAS provides compute. Container limits are set to stay within host capacity with headroom for OS and QTS.

| Resource | Container limits total | Host available (est.) | Headroom        |
|----------|------------------------|------------------------|-----------------|
| Memory   | ~1,920 MB              | 8 GB                   | ~6 GB for OS/QTS |
| vCPUs    | 3.75                   | 4 cores                | ~0.25 for OS    |

If the host has less than 8 GB RAM, reduce per-container limits in `infra/docker/docker-compose.prod.yml` to avoid OOM kills.

### 3.3 Containers

| Environment | Stack prefix | Example containers |
|-------------|--------------|--------------------|
| `production` | `twp-prod` | `twp-prod-web`, `twp-prod-api`, `twp-prod-postgres` |
| `dev` | `twp-dev` | `twp-dev-web`, `twp-dev-api`, `twp-dev-postgres` |

`IMAGE_TAG` is set by the deploy script (see Deploy script options). App images are environment-specific (`twp-prod-*` or `twp-dev-*`), while Postgres, Redis, and cloudflared use fixed upstream images.

---

## 4. First-time Setup

1. **Clone the repo** on the QNAP (e.g. inside the `ubuntu-sshd` data mount):
   ```bash
   cd ~ && git clone <repo-url> tw-portfolio
   ```

2. **Create the environment file on the deploy host**:
   ```bash
   cp infra/docker/.env.prod.example infra/docker/.env.prod
   # Edit .env.prod with real passwords, tunnel token, and AUTH_USER_ID (required for AUTH_MODE=oauth)
   chmod 600 infra/docker/.env.prod
   ```
   For the dev lane, create a separate file:
   ```bash
   cp infra/docker/.env.dev.example infra/docker/.env.dev
   # Edit .env.dev with dev-specific passwords, tunnel token, public domains, and AUTH_USER_ID
   chmod 600 infra/docker/.env.dev
   ```
   With `AUTH_MODE=oauth`, set `AUTH_USER_ID` to a stable user id (e.g. `user-1` or your email). The web app sends it as `x-authenticated-user-id` on every API request so endpoints like `GET /settings` succeed instead of returning 401.

3. **Configure the Cloudflare Tunnel** in the Cloudflare Zero Trust dashboard (see `infra/cloudflared/README.md`). Add both public hostnames for the web and API services.

4. **Deploy**:
   ```bash
   cd ~/tw-portfolio
   bash infra/scripts/deploy.sh --environment production
   ```

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

Migrations run in a dedicated image (`db/Dockerfile.migrate`) that bakes SQL files in at build time. The runner (`infra/scripts/run-migrations.sh`) applies files in sorted order with `ON_ERROR_STOP=1` and stops on first failure. All `.sql` files in `db/migrations/` must be idempotent (use `IF NOT EXISTS` / `IF EXISTS` guards). Non-idempotent schema changes require a versioned migration runner (tracked in backlog).

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

## 13. App behavior (reference)

The following sections describe product behavior for support and verification. They are not part of the deployment procedure.

### 13.1 Page-load progress bar

- The thin bar at the very top during **initial page load** is a frontend-only visual indicator.
- It is rendered by the web app’s root layout (`apps/web/app/layout.tsx`) via `LoadingProgressBar` (`apps/web/components/ui/LoadingProgressBar.tsx`) and styled in `apps/web/app/globals.css` (`.loading-progress`, `.loading-progress__bar`).
- The bar shows briefly on first load with a minimum visible duration, advances quickly then creeps toward ~80% on slower loads, and jumps to 100% and hides when the frontend considers the page ready. It does **not** track client-side route transitions.
- Accessibility: respects `prefers-reduced-motion`; uses `aria-live="off"` to avoid spamming screen readers.
- **Operational note**: This bar reflects perceived performance, not backend health; use `/health/live` and `/health/ready` for service status. If the bar is missing or wrong, verify the web container serves the expected layout, `globals.css` (including `.loading-progress` and theme tokens) is loaded, and no overlay is masking the bar (it uses `z-index: 1000`).

### 13.2 Settings drawer

- Open settings from the top-right avatar. Drawer URL state is `/?drawer=settings` for direct linking.
- Tabs: **General** and **Fee Profiles**. **Save Settings** persists locale, poll interval, weighted-average cost basis, and fee profiles atomically via `/settings/full`. Fee profiles support account fallback and per-security overrides; new profile IDs are system-generated (UUID). **Discard Changes** reverts unsaved edits without closing the drawer. Closing with unsaved edits shows a warning.

### 13.3 Localization

- UI locales: `en` and `zh-TW`. After saving locale, visible wording (including settings tabs and dialogs) switches to the selected language. If language appears stale, reopen the settings drawer or reload and verify the `/settings` response.

### 13.4 Tooltips

- Settings terms and key financial terms on the dashboard/forms have hover/focus tooltips. Weighted-average cost basis includes detailed explanatory content in settings. Tooltips are keyboard-accessible via the info icon triggers.
