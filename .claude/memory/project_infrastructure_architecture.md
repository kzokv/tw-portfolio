---
name: project_infrastructure_architecture
description: tw-portfolio deployment targets, Docker compose environments, and CI deploy path via Cloudflare WARP + SSH to QNAP server
type: project
---

## Deployment Target

The project deploys to a **QNAP NAS server at 192.168.2.10**. GitHub Actions reaches it via **Cloudflare WARP + SSH**.

## Docker Compose Environments

| Environment | File | Container prefix | Ports |
|-------------|------|-----------------|-------|
| dev | `docker-compose.dev.yml` | `twp-dev-*` | web 5454, api 6363 |
| production | `docker-compose.prod.yml` | `twp-prod-*` | (standard) |
| local (new) | `docker-compose.local.yml` | `twp-local-*` | web 5732, api 6679, storybook 4300, adminer 3300 |

## CI/CD Flow

1. GitHub Actions builds and tests on the hosted runner (host-level, no Docker)
2. New Docker build validation job builds images to catch Dockerfile drift
3. On merge to `main`, CI SSHes into QNAP via Cloudflare WARP and runs `docker compose up --build -d`

## Local Docker validation

Use `docker-compose.local.yml` to validate the full Docker build locally before pushing. This catches issues (e.g., missing packages in COPY stages) that host builds miss.
