# ADR: QNAP + Cloudflare WARP Deployment Architecture

**Date:** 2026-03-01
**Status:** Active (frozen reference snapshot)

## Infrastructure Overview

### Deployment Target
- **Hardware:** QNAP NAS server at `192.168.2.10` (private network)
- **Access:** Cloudflare WARP + SSH (secure tunnel from GitHub Actions)
- **Deployment:** Via GitHub Actions CI/CD pipeline

### Why QNAP + Cloudflare WARP?
- Self-hosted infrastructure on private network
- Cloudflare Tunnel provides secure, authenticated access without exposing SSH
- No public IP required; no firewall rule changes needed
- Zero-trust network architecture

## Docker Compose Environments

| Environment | File | Containers | Host Ports | Access |
|---|---|---|---|---|
| **local** | `docker-compose.local.yml` | `twp-local-*` | web:3300, api:4300, db:5732, redis:6679 | Localhost only |
| **dev** | `docker-compose.dev.yml` | `twp-dev-*` | web/api:cloudflared, db:5454, redis:6363 | Cloudflare tunnel |
| **prod** | `docker-compose.prod.yml` | `twp-prod-*` | All via cloudflared | Cloudflare tunnel |

## Cloudflare Tunnel Configuration

Both dev and prod environments use Cloudflare Tunnel for ingress:
- **Web subdomain:** `twp-dev-web.kzokvdevs.dpdns.org` → localhost:3000 (dev) / :3333 (prod)
- **API subdomain:** `twp-dev-api.kzokvdevs.dpdns.org` → localhost:4000 (dev) / :5000 (prod)

Session cookies must use shared domain (`.kzokvdevs.dpdns.org`) to work across subdomains.

## CI/CD Deployment Flow

1. **Local host-level builds** — npm/tsc on GitHub Actions runner (fast)
2. **Docker build validation** — GitHub Actions builds images (catch Dockerfile drift)
3. **Deploy to QNAP** — On `main` merge:
   - SSH via Cloudflare WARP to QNAP `192.168.2.10`
   - Run `docker compose up --build -d`
   - Health checks verify deployment success

### Why Two Build Stages?

Host-level builds are fast but don't catch Dockerfile issues (missing packages in COPY stages). Docker build job validates before deploy, preventing deploy-time failures.

## Local Docker Validation Stack

`docker-compose.local.yml` runs full stack locally to catch issues before push:

```bash
npm run dev:docker:validate      # Build, migrate, start
npm run dev:docker:validate:teardown  # Stop and clean
```

**Benefits:**
- Dockerfile dependency drift detected locally (before CI)
- Migration scripts tested against real Postgres
- Full application flow validated
- Prevents "works on my machine" deploy surprises

### Local Stack AUTH_MODE

Defaults to `AUTH_MODE=oauth` (not dev_bypass) because:
- Validates OAuth plumbing matches production
- Local Docker runs `NODE_ENV=production` for realistic behavior
- Tests cross-subdomain cookie domain scoping

## Environment Variables

### Sourcing Strategy

Three env file targets:
- **`.env.local`** (root) — Local development overrides
- **`infra/docker/.env.dev`** — Dev deployment
- **`infra/docker/.env.prod`** — Prod deployment

Generated via `npm run env:setup` with Zod-validated schemas.

### Key Vars for Deployment

- `GOOGLE_REDIRECT_URI` — Must use cloudflared subdomain + port from cloud perspective
- `SESSION_COOKIE_NAME` — Uses `g_auth_session` (no `__Host-` prefix for cross-subdomain)
- `COOKIE_DOMAIN` — Must be `.kzokvdevs.dpdns.org` (parent of web + api subdomains)
- `PUBLIC_DOMAIN_WEB` / `PUBLIC_DOMAIN_API` — Cloudflared subdomain URLs

## Migration Path

Infrastructure is stable. Future changes should preserve:
1. Private network + Cloudflare Tunnel isolation
2. Separate dev/prod Docker environments
3. Local validation stack for pre-push testing
4. QNAP as primary deployment target
