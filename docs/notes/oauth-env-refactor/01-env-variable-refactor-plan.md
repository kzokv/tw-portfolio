# Environment Variable Refactor Plan

> Produced from grill-me session on 2026-03-21. All decisions finalized through structured interview.

---

## 1. Use Case Matrix

### 1.1 Runtime Contexts

| # | npm script | AUTH_MODE | PERSISTENCE | Transport | NODE_ENV | DEPLOY_ENV | Where |
|---|-----------|-----------|-------------|-----------|----------|------------|-------|
| 1 | `dev:local:bypass:mem` | `dev_bypass` | `memory` | bare metal | `development` | — | Local machine |
| 2 | `dev:local:bypass:pg` | `dev_bypass` | `postgres` | bare metal | `development` | — | Local machine |
| 3 | `dev:local:oauth:mem` | `oauth` | `memory` | bare metal | `development` | — | Local machine |
| 4 | `dev:local:oauth:pg` | `oauth` | `postgres` | bare metal | `development` | — | Local machine |
| 5 | `dev:docker` | `oauth` | `postgres` | docker-compose.local | `production` | — | Local machine (Docker) |
| 6 | `test:e2e:bypass:mem` | `dev_bypass` | `memory` | bare metal | `test` | — | Local machine |
| 7 | `test:e2e:oauth:mem` | `oauth` | `memory` | bare metal | `test` | — | Local machine |
| 8 | `test:e2e:ci:bypass:mem` | `dev_bypass` | `memory` | bare metal | `test` | — | GitHub Actions |
| 9 | `deploy.sh -e dev` | `oauth` | `postgres` | docker + cloudflared | `production` | `dev` | Cloud (dev) |
| 10 | `deploy.sh -e production` | `oauth` | `postgres` | docker + cloudflared | `production` | `production` | Cloud (prod) |

### 1.2 npm Script Inventory

```
dev                              # help-printer: lists all dev:* variants
dev:local:bypass:mem              # fastest iteration — no auth, in-memory
dev:local:bypass:pg               # bypass auth, real postgres
dev:local:oauth:mem               # Google OAuth, in-memory
dev:local:oauth:pg                # Google OAuth, postgres (closest to prod)
dev:docker                        # Docker Compose local stack (oauth + postgres)
dev:docker:cleanup                # cleanup Docker images/containers
dev:docker:cleanup:dry            # dry run
dev:docker:cleanup:force          # auto-confirm
dev:docker:validate               # validate local compose config
dev:docker:validate:teardown      # validate then tear down

test:e2e                          # help-printer: lists all test:e2e:* variants
test:e2e:bypass:mem               # dev_bypass E2E suite, in-memory
test:e2e:oauth:mem                # oauth E2E suite, in-memory
test:e2e:ci:bypass:mem            # CI variant (GitHub Actions)
```

### 1.3 Environment Variable Values Per Context

| Variable | dev:local:bypass:mem | dev:local:bypass:pg | dev:local:oauth:mem | dev:local:oauth:pg | dev:docker | Cloud dev | Cloud prod |
|----------|---------------------|--------------------|--------------------|-------------------|-----------|-----------|-----------|
| `NODE_ENV` | development | development | development | development | production | production | production |
| `DEPLOY_ENV` | — | — | — | — | — | dev | production |
| `AUTH_MODE` | dev_bypass | dev_bypass | oauth | oauth | oauth | oauth | oauth |
| `PERSISTENCE_BACKEND` | memory | postgres | memory | postgres | postgres | postgres | postgres |
| `API_PORT` | 4000 | 4000 | 4000 | 4000 | 4000 (host: 4300) | 4000 | 4000 |
| `WEB_PORT` | 3333 | 3333 | 3333 | 3333 | 3000 (host: 3300) | 3000 | 3000 |
| `DB_URL` | — | auto-built | — | auto-built | compose-internal | compose-internal | compose-internal |
| `REDIS_URL` | — | auto-built | — | auto-built | compose-internal | compose-internal | compose-internal |
| `GOOGLE_CLIENT_ID` | — | — | required | required | required | required | required |
| `GOOGLE_CLIENT_SECRET` | — | — | required | required | required | required | required |
| `GOOGLE_REDIRECT_URI` | — | — | localhost:4000 | localhost:4000 | localhost:4300 | computed | computed |
| `SESSION_SECRET` | — | — | required | required | required | required | required |
| `SESSION_COOKIE_NAME` | — | — | `__Host-g_auth_session` | `__Host-g_auth_session` | `g_auth_session` | `g_auth_session` | `g_auth_session` |
| `COOKIE_DOMAIN` | — | — | — | — | — | `.kzokvdevs.dpdns.org` | `.kzokvdevs.dpdns.org` |
| `APP_BASE_URL` | — | — | localhost:3333 | localhost:3333 | localhost:3300 | computed | computed |
| `PUBLIC_DOMAIN_WEB` | — | — | — | — | — | twp-dev-web.* | twp-web.* |
| `PUBLIC_DOMAIN_API` | — | — | — | — | — | twp-dev-api.* | twp-api.* |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | — | — | — | — | required | required |
| `POSTGRES_USER` | — | — | — | — | required | required | required |
| `POSTGRES_PASSWORD` | — | — | — | — | required | required | required |
| `REDIS_PASSWORD` | — | — | — | — | required | required | required |

Legend: `—` = not applicable / not set, `required` = must be provided, `computed` = derived in docker-compose from `PUBLIC_DOMAIN_*`, `auto-built` = constructed from DB_PORT/REDIS_PORT if DB_URL/REDIS_URL not set.

---

## 2. Environment File Architecture

### 2.1 Single Source of Truth

```
.env.example                      # Master reference: ALL vars documented (app + docker + web)
.env.local                        # Generated by env:setup — local dev secrets (gitignored)
infra/docker/.env.dev             # Generated by env:setup — cloud dev (gitignored)
infra/docker/.env.prod            # Generated by env:setup — cloud prod (gitignored)
infra/docker/.env.local           # Generated by env:setup — docker local (gitignored)
```

**Eliminated files:**
- `apps/web/.env.example` — `NEXT_PUBLIC_*` folded into root schema
- `apps/web/.env.local` — not needed (Next.js reads from root `.env.local`)
- `infra/docker/.env.dev.example` — replaced by unified `.env.example`
- `infra/docker/.env.prod.example` — replaced by unified `.env.example`
- `.env.example` per-Docker-context — one `.env.example` covers all

**File count: 4 example files → 1 example file. 9 env-setup targets → 4 targets.**

### 2.2 env-setup Targets (after refactor)

| Target ID | Label | Output Path | Schema |
|-----------|-------|-------------|--------|
| `root:local` | Root: local | `.env.local` | `envSchema` |
| `docker:dev` | Docker: dev | `infra/docker/.env.dev` | `dockerCloudSchema` |
| `docker:prod` | Docker: prod | `infra/docker/.env.prod` | `dockerCloudSchema` |
| `docker:local` | Docker: local | `infra/docker/.env.local` | `dockerLocalSchema` |

### 2.3 Schema Consolidation

| Schema | Purpose | Changes |
|--------|---------|---------|
| `envSchema` | Root app config | `DEPLOY_ENV` stays out (Docker-only); `NEXT_PUBLIC_*` stays out (web-only — leaks web concerns into API) |
| `webEnvSchema` | Web-side env (Edge Runtime safe) | **KZO-101**: kept as separate schema derived via `envSchema.pick({ SESSION_SECRET, SESSION_COOKIE_NAME }).extend({ NEXT_PUBLIC_* })` — NOT folded into `envSchema` (original plan overturned — see doc 05 decision #1) |
| `dockerCloudSchema` | Unified dev + prod Docker | **KZO-102**: merged `dockerDevSchema` + `dockerProdSchema`; added `DEPLOY_ENV`; `COOKIE_DOMAIN` now required (no default) |
| `dockerLocalSchema` | Docker local (no tunnel) | **KZO-102**: port fields aligned to `z.coerce.number()` |
| `e2eEnvSchema` | Test-specific (future) | `GOOGLE_OAUTH_REFRESH_TOKEN` + test config vars — deferred to KZO-103 scope |
| ~~`dockerDevSchema`~~ | Removed | Merged into `dockerCloudSchema` (KZO-102) |
| ~~`dockerProdSchema`~~ | Removed | Merged into `dockerCloudSchema` (KZO-102) |

---

## 3. Validation Rules

| Rule | Enforced By | Description |
|------|------------|-------------|
| Port uniqueness | `validateEnvConstraints()` | API_PORT, WEB_PORT, DB_PORT, REDIS_PORT must all differ |
| dev_bypass restriction | `validateEnvConstraints()` | `AUTH_MODE=dev_bypass` blocked when `NODE_ENV=production` (denylist — allows dev_bypass in `test` for E2E CI) |
| OAuth required vars | `validateEnvConstraints()` | When `AUTH_MODE=oauth`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET` all required |
| Hostname consistency | `validateHostConsistency()` | `APP_BASE_URL` and `GOOGLE_REDIRECT_URI` must use same hostname in development (prevents localhost/127.0.0.1 mixing) |
| Redirect port match | `validateHostConsistency()` | `GOOGLE_REDIRECT_URI` port must match `API_PORT` in development (not enforced in Docker — port mapping differs) |
| Cookie config | `validateCookieConfig()` | `__Host-` prefix + `COOKIE_DOMAIN` is forbidden (RFC 6265bis — `__Host-` is host-bound, incompatible with Domain attribute) |
| Cross-subdomain cookie | `validateCookieDomainRequired()` | When `PUBLIC_DOMAIN_WEB ≠ PUBLIC_DOMAIN_API`, `COOKIE_DOMAIN` must be set (KZO-102 addition in `env-docker.ts`) |

---

## 4. Flow Diagrams

### 4.1 Environment Loading Flow

```mermaid
flowchart TD
    A[Application starts] --> B{APP_ENV_FILE<br/>set?}
    B -->|Yes| C[Load file at<br/>APP_ENV_FILE path]
    B -->|No| D[Walk up from<br/>compiled file location]
    D --> E{Found package.json<br/>with workspaces?}
    E -->|Yes| F[Load .env.local<br/>at workspace root]
    E -->|No, keep walking| D
    E -->|Reached filesystem root| G[Skip gracefully<br/>Docker/CI injects vars]
    C --> H[Parse with Zod<br/>envSchema]
    F --> H
    G --> H
    H --> I{Validation}
    I --> J[validateEnvConstraints]
    I --> K[validateHostConsistency]
    I --> L[validateCookieConfig]
    J --> M{AUTH_MODE?}
    M -->|oauth| N[Check required<br/>OAuth vars present]
    M -->|dev_bypass| O{NODE_ENV =<br/>production?}
    O -->|Yes| P[ERROR: dev_bypass<br/>not allowed in production]
    O -->|No| Q[OK — allowed in<br/>development and test]
    N --> Q
    K --> Q
    L --> Q
```

### 4.2 Auth Mode Decision Flow

```mermaid
flowchart TD
    A[Request arrives] --> B{AUTH_MODE?}

    B -->|dev_bypass| C[Read user ID<br/>from cookie/header]
    C --> D[Skip OAuth entirely]
    D --> E[Proceed with<br/>user context]

    B -->|oauth| F{Session cookie<br/>present?}
    F -->|No| G[Redirect to<br/>Google OAuth]
    G --> H[Google consent screen]
    H --> I[Callback with<br/>auth code]
    I --> J[Exchange code<br/>for tokens]
    J --> K{GOOGLE_TOKEN_URL<br/>set?}
    K -->|Yes| L[Use override URL<br/>E2E mock server]
    K -->|No| M[Use real Google<br/>token endpoint]
    L --> N[Verify ID token]
    M --> N
    N --> O[Create HMAC-signed<br/>session cookie]
    O --> E

    F -->|Yes| P[Verify HMAC<br/>signature]
    P -->|Valid| E
    P -->|Invalid| G
```

### 4.3 Cookie Configuration Decision Flow

```mermaid
flowchart TD
    A[Determine cookie config] --> B{Deployment type?}

    B -->|Bare metal local| C["SESSION_COOKIE_NAME=<br/>__Host-g_auth_session"]
    C --> D["COOKIE_DOMAIN=<br/>(not set)"]
    D --> E["Cookie is host-bound<br/>to localhost"]

    B -->|Docker local| F["SESSION_COOKIE_NAME=<br/>g_auth_session"]
    F --> G["COOKIE_DOMAIN=<br/>(not set)"]
    G --> H["Cookie scoped to<br/>localhost (HTTP, no __Host-)"]

    B -->|Cloud dev/prod| I["SESSION_COOKIE_NAME=<br/>g_auth_session"]
    I --> J["COOKIE_DOMAIN=<br/>.kzokvdevs.dpdns.org"]
    J --> K["Cookie shared across<br/>API + web subdomains"]

    E --> L{Validate}
    H --> L
    K --> L
    L --> M{"__Host- prefix +<br/>COOKIE_DOMAIN?"}
    M -->|Yes| N["ERROR: incompatible<br/>(RFC 6265bis)"]
    M -->|No| O[OK]
```

### 4.4 npm Script Dispatch Flow

```mermaid
flowchart TD
    A["npm run dev"] --> B["Help printer:<br/>lists all dev:* variants"]

    C["npm run dev:local:bypass:mem"] --> D["dev.sh"]
    E["npm run dev:local:bypass:pg"] --> D
    F["npm run dev:local:oauth:mem"] --> D
    G["npm run dev:local:oauth:pg"] --> D

    D --> H["Source .env.local<br/>(secrets)"]
    H --> I["Override AUTH_MODE +<br/>PERSISTENCE_BACKEND"]
    I --> J["Print startup banner"]
    J --> K["Start API + Web<br/>(bare metal)"]

    L["npm run dev:docker"] --> M["dev-docker.sh"]
    M --> N["Source infra/docker/.env.local"]
    N --> O["Print startup banner"]
    O --> P["docker compose<br/>up --build"]

    Q["npm run test:e2e"] --> R["Help printer:<br/>lists all test:e2e:* variants"]
```

### 4.5 dev.sh Startup Banner Format

```
── dev:local:oauth:pg ──────────────────────────

  Mode-specific:
    AUTH_MODE              oauth
    PERSISTENCE_BACKEND    postgres
    DB_URL                 postgres://app:app@127.0.0.1:5432/tw_portfolio

  Inherited:
    NODE_ENV               development
    API_PORT               4000
    WEB_PORT               3333
    ALLOWED_ORIGINS        http://localhost:3333,...
    SESSION_COOKIE_NAME    __Host-g_auth_session
    APP_BASE_URL           http://localhost:3333
    GOOGLE_REDIRECT_URI    http://localhost:4000/auth/google/callback

────────────────────────────────────────────────
```

### 4.6 Environment File Generation Flow

```mermaid
flowchart TD
    A["npm run env:setup"] --> B{Interactive?}

    B -->|Yes| C["Select target(s)<br/>from checkbox"]
    B -->|No| D["--target flag<br/>specifies targets"]

    C --> E{Target file<br/>exists?}
    D --> E

    E -->|Yes| F["Choose merge strategy:<br/>sync or override"]
    E -->|No| G["Fresh generation"]

    F --> H["Read .env.example<br/>(master reference)"]
    G --> H

    H --> I["Resolve values:<br/>existing > source > default"]
    I --> J{"Sensitive key?"}
    J -->|Yes, auto-generable| K["Offer auto-generate<br/>(crypto.randomBytes)"]
    J -->|Yes, not auto| L["Password prompt<br/>(masked input)"]
    J -->|No| M["Standard input<br/>with default"]

    K --> N["Generate file content<br/>grouped by section"]
    L --> N
    M --> N
    N --> O["Write to target path"]
```

### 4.7 E2E Auth Setup Flow

```mermaid
flowchart TD
    A["auth.setup.ts"] --> B{"GOOGLE_OAUTH_REFRESH_TOKEN<br/>in env?"}

    B -->|Yes| C["Path A: Local dev"]
    C --> D["Exchange refresh token<br/>for id_token via<br/>real Google endpoint"]
    D --> E{"Token valid?"}
    E -->|No, invalid_grant| F["ERROR: run<br/>npm run auth:refresh-token"]
    E -->|Yes| G["POST /__e2e/oauth-session<br/>with id_token"]

    B -->|No| H["Path B: CI"]
    H --> I["POST /__e2e/oauth-session<br/>with hardcoded sub"]

    G --> J["Extract session cookie<br/>from Set-Cookie header"]
    I --> J
    J --> K["Save auth state to<br/>.auth/oauth-session.json"]
```

### 4.8 Variable Dependency Graph

```mermaid
flowchart LR
    subgraph "Mode Switches"
        AM["AUTH_MODE"]
        PB["PERSISTENCE_BACKEND"]
        NE["NODE_ENV"]
        DE["DEPLOY_ENV"]
    end

    subgraph "OAuth (required when AUTH_MODE=oauth)"
        GCI["GOOGLE_CLIENT_ID"]
        GCS["GOOGLE_CLIENT_SECRET"]
        GRU["GOOGLE_REDIRECT_URI"]
        SS["SESSION_SECRET"]
        SCN["SESSION_COOKIE_NAME"]
        CD["COOKIE_DOMAIN"]
        ABU["APP_BASE_URL"]
        GTU["GOOGLE_TOKEN_URL"]
    end

    subgraph "Database (required when PERSISTENCE_BACKEND=postgres)"
        DBU["DB_URL"]
        RU["REDIS_URL"]
        DBP["DB_PORT"]
        RP["REDIS_PORT"]
    end

    subgraph "Docker-only"
        PDW["PUBLIC_DOMAIN_WEB"]
        PDA["PUBLIC_DOMAIN_API"]
        CFT["CLOUDFLARE_TUNNEL_TOKEN"]
        PU["POSTGRES_USER"]
        PP["POSTGRES_PASSWORD"]
        PD["POSTGRES_DB"]
        RPW["REDIS_PASSWORD"]
    end

    subgraph "Ports"
        AP["API_PORT"]
        WP["WEB_PORT"]
    end

    subgraph "E2E Test only"
        GRT["GOOGLE_OAUTH_REFRESH_TOKEN"]
    end

    AM -->|"oauth"| GCI
    AM -->|"oauth"| GCS
    AM -->|"oauth"| GRU
    AM -->|"oauth"| SS
    AM -->|"dev_bypass"| NE
    NE -->|"must be development<br/>for dev_bypass"| AM

    PB -->|"postgres"| DBU
    PB -->|"postgres"| RU

    SCN -->|"__Host- prefix<br/>incompatible"| CD
    PDA -->|"computed in compose"| GRU
    PDW -->|"computed in compose"| ABU
    PDA -->|"computed in compose"| ABU

    GRU -->|"port must match<br/>in development"| AP

    GCI -->|"required for<br/>refresh flow"| GRT
    GCS -->|"required for<br/>refresh flow"| GRT

    PP -->|"builds"| DBU
    RPW -->|"builds"| RU
```

### 4.9 Post-Worktree-Create Flow

```mermaid
flowchart TD
    A["git worktree add"] --> B["post-worktree-create.sh"]
    B --> C["npm run env:setup<br/>--target root:local,docker:local<br/>--non-interactive --source MAIN_ROOT"]
    C --> D["npm ci"]
    D --> E["npm run build"]
    E --> F{"Prompt: Run<br/>auth:refresh-token?<br/>[Y/n]"}
    F -->|Yes| G["npm run auth:refresh-token<br/>(opens browser for<br/>Google consent)"]
    F -->|No| H["Skipped — run later<br/>if needed"]
    G --> I["GOOGLE_OAUTH_REFRESH_TOKEN<br/>saved to .env.local"]
    I --> J["Worktree ready"]
    H --> J
```

---

## 5. Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `NODE_ENV=production` for all Docker; `DEPLOY_ENV` for tier | `NODE_ENV` is a runtime concern (perf, error verbosity). Deployment tier is a separate axis. Avoids confusing `NODE_ENV=development` in cloud dev. |
| 2 | Single `.env.example` at root | Eliminates 3 extra example files. One place to see all vars. |
| 3 | Generated env files are complete (not thin overrides) | Full visibility — no mental merging of defaults + overrides. |
| 4 | Compose-computed vars documented as comments in generated files | Prevents conflicts with docker-compose interpolation while keeping visibility. |
| 5 | `webEnvSchema` folded into `envSchema` | Next.js reads from root `.env.local`; no need for separate `apps/web/.env.example`. |
| 6 | Two Docker schemas: `dockerCloudSchema` + `dockerLocalSchema` | Cloud needs tunnel/domains; local doesn't. Type safety preserved for cloud-required vars. |
| 7 | `GOOGLE_OAUTH_REFRESH_TOKEN` in `e2eEnvSchema` only | Only consumed by Playwright; shouldn't validate on every app startup. |
| 8 | `dev.sh` handles modes via env var overrides (Approach A) | Secrets live in `.env.local`; mode switched at launch time. No file multiplication. |
| 9 | `dev:docker` is a thin compose wrapper, not `deploy.sh` | `deploy.sh` is for cloud deployments (git checkout, rollback, backups). Dev iteration needs `up --build` only. |
| 10 | `infra/docker/.env.local` gitignored | Was tracked with real secrets — now generated by `env:setup`. |
| 11 | Help-printers for `npm run dev` and `npm run test:e2e` | Discoverability without memorizing all variants. |
| 12 | Post-worktree hook runs `auth:refresh-token` with skip prompt | Defaults to yes; skippable for non-OAuth work; skipped in non-interactive/CI mode. |

---

## 6. Sensitive Keys

| Key | Auto-generable | Notes |
|-----|---------------|-------|
| `POSTGRES_PASSWORD` | Yes (`openssl rand -hex 32`) | Docker only |
| `REDIS_PASSWORD` | Yes | Docker only |
| `SESSION_SECRET` | Yes | Required for OAuth HMAC signing |
| `GOOGLE_CLIENT_SECRET` | No (from Google Cloud Console) | Never expose to clients |
| `CLOUDFLARE_TUNNEL_TOKEN` | No (from Cloudflare dashboard) | Cloud only |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | No (from `auth:refresh-token` script) | E2E test only, stored in `.env.local` |
