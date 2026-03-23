---
name: project_infrastructure_architecture
description: tw-portfolio deployment targets, Docker compose environments, and CI deploy path via Cloudflare WARP + SSH to QNAP server
type: project
---

## Deployment Target

The project deploys to a **QNAP NAS server at 192.168.2.10**. GitHub Actions reaches it via **Cloudflare WARP + SSH**.

## Docker Compose Environments

| Environment | File | Container prefix | Host ports |
|-------------|------|-----------------|------------|
| local | `docker-compose.local.yml` | `twp-local-*` | web 3300, api 4300, postgres 5732, redis 6679 |
| dev | `docker-compose.dev.yml` | `twp-dev-*` | postgres 5454, redis 6363 (web/api via cloudflared) |
| production | `docker-compose.prod.yml` | `twp-prod-*` | (via cloudflared) |

## CI/CD Flow

1. GitHub Actions builds and tests on the hosted runner (host-level, no Docker)
2. New Docker build validation job builds images to catch Dockerfile drift
3. On merge to `main`, CI SSHes into QNAP via Cloudflare WARP and runs `docker compose up --build -d`

## Local Docker validation

Use `docker-compose.local.yml` to validate the full Docker build locally before pushing. This catches issues (e.g., missing packages in COPY stages) that host builds miss.
