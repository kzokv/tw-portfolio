# macOS Guest VM Docker Setup and Troubleshooting

This guide documents Docker connectivity pitfalls when running `tw-portfolio` integration CI from a **macOS guest VM** that talks to a Docker daemon on a **different host** (for example, the physical macOS machine).

## Topology

- Physical macOS host runs Docker daemon.
- macOS guest VM runs repo commands.
- Guest VM reaches host Docker via TCP (for example `DOCKER_HOST=tcp://192.168.64.1:23750`).

In this topology, `localhost` inside the guest VM is the guest itself, not the physical host.

## Required baseline checks

Run from the same shell where you execute tests:

```bash
echo "DOCKER_HOST=${DOCKER_HOST-}"
docker info
docker ps
```

Expected:

- `DOCKER_HOST` points to your bridged daemon endpoint.
- `docker info` and `docker ps` succeed.

If `docker` or `docker compose` (without subcommands) prints help, that only confirms CLI installation, not daemon connectivity.

## Integration CI commands

- Host shell / guest VM shell:
  - `npm run test:integration:ci:host`
- Linux/containerized shell:
  - `npm run test:integration:ci:container`

## Issues encountered and fixes

### 1. Docker daemon not reachable

Symptom:

```text
ERROR: Docker daemon is not reachable.
```

Cause:

- Shell did not export `DOCKER_HOST`, so Docker fell back to `unix:///var/run/docker.sock`.
- On guest VM, `/var/run/docker.sock` may not exist.

Fix:

1. Export `DOCKER_HOST` in the shell used to run tests.
2. Persist it for that shell family (`~/.bash_profile` and/or `~/.bashrc` for bash, `~/.zshrc` for zsh).
3. Recheck with `docker info`.

### 2. Credential helper missing (`docker-credential-desktop`)

Symptom:

```text
error getting credentials - err: exec: "docker-credential-desktop": executable file not found in $PATH
```

Cause:

- `~/.docker/config.json` had `"credsStore": "desktop"` but helper binary was unavailable in VM PATH.

Fix options:

1. Remove `credsStore` from VM Docker config (public image pull use case).
2. Use VM-specific Docker config:

```bash
mkdir -p ~/.docker-vm
printf '{}\n' > ~/.docker-vm/config.json
export DOCKER_CONFIG="$HOME/.docker-vm"
```

Then verify:

```bash
docker pull postgres:16
docker pull redis:7
```

### 3. Postgres migration tests unexpectedly skipped

Symptom:

- Vitest shows `postgres-migrations.integration.test.ts` skipped.

Cause:

- API `test:integration` script intentionally forces:
  - `RUN_POSTGRES_INTEGRATION=0`
  - empty Postgres test URLs

Fix:

- Use managed CI commands (`test:integration:ci:host` / `test:integration:ci:container`) which run `test:integration:full` with required Postgres env vars.
- Keep plain `npm run test:integration` as the non-Postgres integration path.

### 4. `host.docker.internal` confusion

Symptom:

- `host.docker.internal` works in some contexts but not others.

Clarification:

- For `test:integration:ci:container`, `host.docker.internal` is required and must resolve.
- For `test:integration:ci:host` in guest VM topology, host routing is resolved from:
  1. `CI_TEST_HOST` (explicit override)
  2. `DOCKER_HOST` TCP host
  3. OS default gateway
  4. `localhost`

If auto-detection fails, set:

```bash
CI_TEST_HOST=<physical-host-ip-or-dns> npm run test:integration:ci:host
```

## Recommended VM shell profile

For bash-based sessions:

```bash
export DOCKER_HOST=tcp://192.168.64.1:23750
# Optional: VM-specific Docker config without desktop credsStore
# export DOCKER_CONFIG="$HOME/.docker-vm"
```

After updating profile files, open a new shell and validate `docker info` again.
