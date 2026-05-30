# Cloudflare WARP-to-Tunnel SSH Setup for GitHub Actions Deploy

## Overview

GitHub Actions deploys to the QNAP by:

1. enrolling the GitHub-hosted runner into Cloudflare WARP with a service token
2. routing SSH traffic for the private deploy target through a Cloudflare private route
3. SSHing directly to the private deploy host over that route

This repository does not use `cloudflared access ssh` for automated deploys.
It uses WARP on the runner side plus a Cloudflare Tunnel or equivalent private-network connector on the QNAP side.

## Setup Steps

### 1. Run a Cloudflare Tunnel or private-network connector on the QNAP side

You need a connector on the private-network side. WARP on the GitHub runner is only the client-side on-ramp.

Requirements:

- Run Cloudflare Tunnel, WARP Connector, or an equivalent supported Cloudflare private-network connector on the QNAP side.
- Confirm it stays connected and healthy.
- Confirm it can reach the deploy host over SSH on the local network.

Without this connector, the GitHub runner can authenticate to WARP and still fail with `No route to host`.

### 2. Configure the private route for SSH

In Cloudflare Zero Trust:

1. Go to **Networks** -> **Routes** -> **CIDR**
2. Add a route covering the private deploy host, for example `192.0.2.10/32`
3. Attach that route to the tunnel running on the QNAP side

`DEPLOY_HOST` in GitHub must match the host covered by this private route.

Examples:

- single host: `192.168.2.61/32`
- single host: `192.0.2.10/32`
- small range: use the narrowest CIDR or a few exact routes instead of a broad subnet

Validation:

```bash
nc -vz 192.0.2.10 22
```

Run that from a trusted machine on the same private network as the QNAP-side connector. If it fails there, WARP will not fix it.

### 3. Create a service token for WARP enrollment

1. Go to **Settings** -> **Service tokens**
2. Create a service token for GitHub Actions deploys
3. Save the **Client ID** and **Client Secret**

### 4. Allow that service token to enroll WARP devices

1. Create an Access policy:
   - **Action**: `Service Auth`
   - **Include**: the deploy service token
2. Attach that policy to:
   - **Settings** -> **WARP Client** -> **Device enrollment permissions**

### 5. Set GitHub Actions environment secrets

In the `vakwen` repo, configure the `dev` and `production` GitHub Environments with these values:

| Secret                      | Value                                              |
|-----------------------------|----------------------------------------------------|
| `DEPLOY_SSH_KEY`            | SSH private key for the deploy user                |
| `DEPLOY_KNOWN_HOSTS`        | Verified `known_hosts` entry for the deploy host   |
| `CF_ACCESS_CLIENT_ID`       | Service token Client ID from step 3                |
| `CF_ACCESS_CLIENT_SECRET`   | Service token Client Secret from step 3            |
| `CF_TEAM_NAME`              | Cloudflare Zero Trust team name only               |
| `DEPLOY_HOST`               | Private deploy host or IP covered by the route     |
| `DEPLOY_USER`               | `ubuntu`                                           |
| `DEPLOY_PATH`               | Absolute path to the repo on QNAP (e.g. `/data/vakwen`) |

Important:

- `DEPLOY_PATH` must be an absolute path.
- Do not use `~/vakwen`.
- The workflow quotes `DEPLOY_PATH` literally inside the remote SSH command, so `~` does not expand and the preflight file checks fail.

### 6. Create the GitHub Environments

1. Go to **Settings** -> **Environments**
2. Create:
   - `dev`
   - `production`
3. Add the matching secrets to each environment
4. Optionally add required reviewers for the production environment

### 7. Generate the SSH key pair

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f github-actions-deploy -N ""
```

- Add `github-actions-deploy.pub` to `~/.ssh/authorized_keys` for the deploy user on the SSH target
- Add the contents of `github-actions-deploy` as the `DEPLOY_SSH_KEY` secret

### 8. Capture and store the SSH host key

On a trusted machine:

```bash
ssh-keyscan -H 192.0.2.10
```

Verify the fingerprint out-of-band, then store the final line as `DEPLOY_KNOWN_HOSTS`.

### 9. Preflight checklist

Before running GitHub Actions deploys, confirm all of the following:

1. The QNAP-side Cloudflare Tunnel or connector is running
2. The private route for `DEPLOY_HOST` is attached to that tunnel
3. The SSH target is reachable from the QNAP-side network
4. `DEPLOY_HOST` is the private IP or hostname covered by the route
5. `DEPLOY_PATH` is an absolute path and points to the repo checkout that contains `infra/scripts/deploy.sh`
6. The target host has the correct environment file:
   - `infra/docker/.env.dev` for dev
   - `infra/docker/.env.prod` for production
7. The deploy user can run `docker compose`

For the canonical workflow and troubleshooting guide, see [docs/002-operations/runbook.md](/home/ubuntu/github/vakwen/docs/002-operations/runbook.md).
