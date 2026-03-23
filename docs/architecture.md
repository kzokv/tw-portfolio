# System Architecture

This document describes the structural layout, data flow, and deployment topology of the tw-portfolio monorepo.

---

## Monorepo Structure

```mermaid
graph TD
    subgraph "Applications"
        API["apps/api<br/>Fastify API server"]
        WEB["apps/web<br/>Next.js frontend"]
    end

    subgraph "Libraries"
        CFG["libs/config<br/>Env schemas, validation"]
        DOM["libs/domain<br/>Portfolio math (pure)"]
        SHR["libs/shared-types<br/>API/domain contracts"]
    end

    subgraph "Infrastructure"
        DB["db/<br/>Migrations, schema"]
        INF["infra/<br/>Docker, deploy scripts"]
    end

    subgraph "Tooling"
        SCR["scripts/<br/>Dev orchestration"]
        GH[".github/<br/>CI/CD workflows"]
    end

    WEB -->|imports| CFG
    WEB -->|imports| SHR
    API -->|imports| CFG
    API -->|imports| DOM
    API -->|imports| SHR
    DOM -->|imports| SHR
```

| Package | Purpose | Runtime |
|---------|---------|---------|
| `apps/api` | HTTP API: routes, auth, persistence orchestration | Fastify on Node.js |
| `apps/web` | UI: pages, components, middleware, SSR | Next.js (Node + Edge Runtime) |
| `libs/config` | Env loading, Zod schemas, validation helpers | Shared (Node + Edge) |
| `libs/domain` | Accounting math, fee calculation, lot allocation | Pure functions, no I/O |
| `libs/shared-types` | TypeScript type contracts between API and web | Types only, no runtime |
| `db` | SQL migrations, baseline schema | Postgres via migration runner |
| `infra` | Docker Compose files, deploy/validation scripts, Cloudflare config | Shell + Docker |
| `scripts` | Dev server orchestration, env setup, onboarding | Shell + TypeScript |

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant MW as middleware.ts<br/>(Edge Runtime)
    participant P as Next.js Pages<br/>(SSR / Client)
    participant WR as Web API Routes<br/>(app/api/)
    participant API as Fastify API<br/>(:4000)
    participant PG as Postgres
    participant RD as Redis

    B->>MW: GET /dashboard
    MW->>MW: Verify session cookie (HMAC)
    alt Invalid or missing cookie
        MW-->>B: 302 /login
    end
    MW->>P: Pass through (x-current-path header)
    P->>P: SSR resolveSession()

    P->>WR: fetch /api/profile (credentials: include)
    WR->>WR: getSession() + extract userId
    WR->>API: GET /settings (x-authenticated-user-id header)
    API->>API: resolveUserId() from session cookie
    API->>PG: SELECT from users
    API-->>WR: JSON response
    WR-->>P: JSON response
    P-->>B: Rendered HTML

    Note over B,P: Client-side navigation
    B->>API: fetch /portfolio/holdings (credentials: include)
    API->>API: resolveUserId() from session cookie
    API->>PG: Query accounting tables
    API->>RD: Check quote cache
    API-->>B: JSON response
```

### Key Participants

| Component | File | Role |
|-----------|------|------|
| Middleware | `apps/web/proxy.ts` | Route protection, HMAC cookie verification (Edge Runtime) |
| SSR Auth | `apps/web/lib/auth.ts` | Server-side session resolution for React Server Components |
| Web API Routes | `apps/web/app/api/*/route.ts` | Proxy layer forwarding authenticated requests to Fastify API |
| API Auth | `apps/api/src/routes/registerRoutes.ts:resolveUserId()` | Session cookie verification, user identity extraction |
| Persistence | `apps/api/src/persistence/postgres.ts` | Postgres read/write, Redis caching/idempotency |

---

## Persistence Backends

The API supports two backends behind the `Persistence` interface:

| Backend | `PERSISTENCE_BACKEND` | Storage | Use case |
|---------|----------------------|---------|----------|
| Postgres | `postgres` | Postgres (data) + Redis (cache, idempotency) | Production, integration tests |
| Memory | `memory` | In-process Maps | Dev iteration, E2E tests |

### Postgres Write Paths

- **Incremental**: `savePostedTrade`, `savePostedDividend` — single-entity inserts within a transaction
- **Full-store rewrite**: `saveStore`, `saveAccountingStoreTx` — delete-and-reinsert for settings/accounting bulk operations

See [Backend DB and API Architecture Dossier](./backend-db-api-architecture-dossier.md) for the full table catalog and ER diagram.

---

## Deployment Topology

```mermaid
graph TB
    subgraph "Internet"
        CF["Cloudflare Zero Trust"]
    end

    subgraph "GitHub"
        GHA["GitHub Actions Runner"]
    end

    subgraph "QNAP Host (192.168.x.x)"
        subgraph "twp-prod-net"
            PW["web :3000"]
            PA["api :4000"]
            PP["postgres :5432"]
            PR["redis :6379"]
            PC["cloudflared"]
        end

        subgraph "twp-dev-net"
            DW["web :3000"]
            DA["api :4000"]
            DP["postgres :5432"]
            DR["redis :6379"]
            DC["cloudflared"]
        end
    end

    CF -->|"Tunnel ingress<br/>(HTTPS)"| PC
    CF -->|"Tunnel ingress<br/>(HTTPS)"| DC
    PC --> PW
    PC --> PA
    DC --> DW
    DC --> DA

    GHA -->|"WARP + SSH"| PA
    GHA -->|"WARP + SSH"| DA
```

### Environment Tiers

| Tier | Compose File | Project Prefix | Network | Ingress |
|------|-------------|---------------|---------|---------|
| Local | `docker-compose.local.yml` | `twp-local` | `twp-local-net` | Direct localhost (ports 3300/4300) |
| Dev | `docker-compose.dev.yml` | `twp-dev` | `twp-dev-net` | Cloudflare Tunnel |
| Production | `docker-compose.prod.yml` | `twp-prod` | `twp-prod-net` | Cloudflare Tunnel |

### Port Mapping

| Service | Local (host:container) | Dev | Production |
|---------|----------------------|-----|------------|
| Web | 3300:3000 | internal:3000 | internal:3000 |
| API | 4300:4000 | internal:4000 | internal:4000 |
| Postgres | 5732:5432 | 5454:5432 | internal only |
| Redis | 6679:6379 | 6363:6379 | internal only |

Local ports use a +300 offset to avoid collision with bare-metal dev servers (3000/3333 + 4000).

### Container Resource Limits (Cloud)

| Service | Memory | CPU |
|---------|--------|-----|
| Web | 512 MB | 1.0 |
| API | 512 MB | 1.0 |
| Postgres | 512 MB | 1.0 |
| Redis | 256 MB | 0.5 |
| Cloudflared | 128 MB | 0.25 |

Host budget: ~1,920 MB / 3.75 vCPU total vs. ~8 GB / 4 cores available on QNAP.

---

## Build Model

```mermaid
flowchart LR
    subgraph "npm run build (order matters)"
        C["libs/config"] --> D["libs/domain"]
        C --> S["libs/shared-types"]
        D --> A["apps/api"]
        S --> A
        S --> W["apps/web"]
    end
```

- Workspace libraries are **not** built during `npm ci`. Run `npm run build` or `npm run onboard` to build them.
- CI runs explicit `npm run build -w ...` steps in dependency order.
- Docker images run `npm ci` then `npm run build -w ...` in the same order.
- Local dev scripts (`dev:local:*`) rebuild workspace libs when outputs are missing.

---

## Related Docs

- [Environment Variables](./environment-variables.md) — env schemas, validation, generation
- [Auth and Session](./auth-and-session.md) — OAuth, dev_bypass, demo mode, cookies
- [Backend Dossier](./backend-db-api-architecture-dossier.md) — DB schema, API routes, ER diagram
- [Web Frontend Architecture](./web-frontend-architecture.md) — component layering, auth middleware
- [CI/CD](./ci-cd.md) — GitHub Actions, deploy workflows, PR gate
- [Runbook](./runbook.md) — how to run, deploy, and troubleshoot
