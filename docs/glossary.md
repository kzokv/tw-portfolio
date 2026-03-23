# Glossary

Domain-specific terms, project conventions, and system concepts used throughout the tw-portfolio codebase.

---

## Accounting & Portfolio

| Term | Definition |
|------|-----------|
| **Booked Fact** | Append-only accounting record representing posted reality (e.g., `TradeEvent`, `CashLedgerEntry`, `DividendLedgerEntry`). Must never be silently rewritten — corrections use reversals. |
| **Derived State** | Data reproducible from booked facts (e.g., holdings, realized P&L, lot projections). Can be rebuilt; not a source of truth. |
| **Reference Data** | Configuration that informs but is not itself a booked fact (e.g., `FeeProfile`, `DividendEvent`, `SymbolDefinition`). |
| **Reversal** | Canonical correction: a new booked fact negating an original. Both remain visible in the audit chain. |
| **Trade Event** | Booked record for one buy/sell, capturing symbol, quantity, price, fees, taxes, and an immutable fee policy snapshot. |
| **Trade Fee Policy Snapshot** | Immutable copy of fee profile state at trade booking time. Preserves historical fee context for audit and recompute. |
| **Lot** | Inventory unit tracking open quantity, total cost, and opening date/sequence for a security in an account. |
| **Lot Allocation** | Record matching a sell trade to specific lots consumed, with allocated quantity and cost. |
| **Weighted Average** | Cost basis method distributing total acquisition cost proportionally across available shares. Only method currently supported. |
| **Dividend Event** | Issuer-level reference data: ex-date, payment date, per-share amounts. Symbol-scoped, not account-scoped. |
| **Dividend Ledger Entry** | Account-level record of participation in one dividend event, storing expected and actual values plus deductions. |
| **Eligible Quantity** | Shares held at ex-dividend date, determining dividend entitlement for that account. |
| **Fee Profile** | Configuration for commission rates, discount percent, minimum commission, and tax rules. Assignable per user, account, or account+symbol. |
| **Fee Profile Binding** | Mapping applying a specific fee profile to a symbol within an account (per-symbol override). |
| **Instrument Type** | Security category affecting fee/tax treatment: `STOCK`, `ETF`, or `BOND_ETF`. |
| **Day Trade** | Same-day buy-sell, triggering different Taiwan tax treatment. |
| **Booking Sequence** | Per-account, per-date ordering key ensuring deterministic trade processing order. |
| **Reconciliation Status** | Whether a posted fact matches external statements: `unreconciled`, `explained`, or `reconciled`. |
| **Recompute Job** | Workflow previewing alternate fee/tax calculations against existing trades before committing changes. |

## Fees & Taxation (Taiwan-specific)

| Term | Definition |
|------|-----------|
| **BPS (Basis Point)** | 0.01% = 1/10,000. Used for tax rates. E.g., `300 bps = 3%`. |
| **Board Commission** | Baseline exchange transaction fee (~1.425 permille of trade value). Discountable per broker. |
| **Commission Discount Percent** | Broker-specific discount off board commission (0-100%). Stored as percentage. |
| **Rounding Mode** | `FLOOR` (down), `ROUND` (nearest), `CEIL` (up). Applied separately to commission and tax amounts. |

## Authentication & Session

| Term | Definition |
|------|-----------|
| **Auth Mode** | `dev_bypass` (no enforcement, fallback to `user-1`) or `oauth` (full Google OAuth with session cookie). See [Auth and Session](./auth-and-session.md). |
| **HMAC Session Cookie** | Format: `{payload}.{sha256Hmac}`. Payload is `userId` (normal) or `demo:userId` (demo). Signed with `SESSION_SECRET`. |
| **`__Host-` Prefix** | Cookie name prefix (`__Host-g_auth_session`) enforcing host-binding. Requires `Secure` flag, incompatible with `COOKIE_DOMAIN`. Used in bare-metal local HTTPS only. |
| **Cookie Domain** | `COOKIE_DOMAIN` enables cross-subdomain session sharing (e.g., `.kzokvdevs.dpdns.org` for API + web subdomains). |
| **Demo Mode** | Feature flag (`DEMO_MODE_ENABLED`) within `oauth` mode. Creates ephemeral users with seeded data and TTL-limited sessions. |
| **Demo User** | Temporary user via `/auth/demo/start`, seeded with 12 sample transactions. Auto-cleaned after TTL (default 30 min). |
| **External Identity** | Record in `user_external_identities` linking a user to an OAuth provider + provider subject (e.g., Google `sub`). |
| **Provider Subject** | Provider-specific user identifier (Google `sub` claim or demo UUID). Combined with provider name for uniqueness. |
| **resolveOrCreateUser()** | Upserts user by email, upserts external identity, seeds default portfolio on first creation. |
| **resolveUserId()** | API-side function extracting user identity from session cookie (oauth) or header/fallback (dev_bypass). |
| **E2E Session Seeding** | `POST /__e2e/oauth-session` creates test session cookies without real Google OAuth. Blocked in production. |

## Environment & Configuration

| Term | Definition |
|------|-----------|
| **Env Schema** | Zod validation for env vars. Key schemas: `envSchema` (base), `webEnvSchema` (Edge-safe), `dockerCloudSchema`, `dockerLocalSchema`. See [Environment Variables](./environment-variables.md). |
| **Env Setup Target** | Generation destination: `root:local` (.env.local), `docker:local`, `docker:dev`, `docker:prod`. |
| **Context Tag** | `.env.example` annotation marking which targets use each var (e.g., `[Docker cloud only]`, `[oauth only]`). |
| **Edge Runtime** | Next.js serverless compute for middleware. Cannot use `fs` or Node.js internals. Config via `env-web.ts` only. |
| **NEXT_PUBLIC_*** | Env vars baked into Next.js client bundle at Docker build time AND set at runtime in compose `environment`. Both required. |
| **SERVER_API_BASE_URL** | Internal container hostname for server-side API calls (e.g., `http://twp-prod-api:4000`). Avoids hairpinning through Cloudflare. |
| **Persistence Backend** | `memory` (in-process Maps, dev/test) or `postgres` (real DB + Redis, production). |
| **Deploy Env** | `DEPLOY_ENV` (`dev` or `production`) distinguishing cloud tiers. Separate axis from `NODE_ENV`. |

## Infrastructure & Deployment

| Term | Definition |
|------|-----------|
| **Cloudflare Tunnel** | Outbound-only encrypted connection from QNAP to Cloudflare, enabling HTTPS ingress without open inbound ports. |
| **WARP** | Cloudflare client on GitHub Actions runners enabling SSH access to private deploy hosts via Zero Trust service tokens. |
| **cloudflared** | Tunnel daemon on deployment host establishing encrypted tunnel to Cloudflare. Runs as Docker container (`twp-{env}-cloudflared`). |
| **Compose Profile** | Docker Compose `--profile migrate` activating the migration container alongside app services. |
| **Container Network** | Internal Docker bridge (`twp-local-net`, `twp-dev-net`, `twp-prod-net`) for service-to-service communication. |
| **Port Offset** | Local Docker stack uses +300 host ports (3300, 4300, 5732, 6679) to avoid collision with bare-metal dev servers. |
| **Hairpinning** | Inefficient routing where a container traverses external DNS/Cloudflare to reach a same-host service. Avoided using container hostnames. |
| **Project Prefix** | Docker Compose naming: `twp-local`, `twp-dev`, `twp-prod`. Prevents resource collisions between stacks. |
| **deploy.sh** | Main deployment script: preflight, checkout, build, backup, migrate, deploy, health check, rollback. See [CI/CD](./ci-cd.md). |
| **Health Check** | `GET /health/live` (liveness) and `GET /health/ready` (dependency readiness). Deploy script gates on these. |
| **Idempotency Key** | Request-unique Redis key preventing duplicate API mutations (trade/dividend posts). |

## Database & Persistence

| Term | Definition |
|------|-----------|
| **Full-Store Rewrite** | `saveStore`/`saveAccountingStoreTx`: delete-and-reinsert bulk data atomically. Used for settings saves, recompute confirms. |
| **Incremental Write** | `savePostedTrade`/`savePostedDividend`: single-entity insert within transaction. Used for individual trade/dividend posts. |
| **Load Store** | Read operation building in-memory `Store` from Postgres: user settings, accounts, symbols, fee profiles, accounting facts. |
| **Migration** | Numbered SQL file in `db/migrations/` altering schema. Tracked in `schema_migrations` table. Append-only — never delete or rewrite. |
| **Baseline Schema** | `baseline_current_schema.sql` superseding early numbered migrations for fresh databases. |
| **Dormant Table** | Schema table present but unused by current runtime (e.g., `reconciliation_records`). Kept for history/future features. |
| **Soft Delete** | Logical deletion via `deleted_at`/`deactivated_at` timestamp rather than row removal. |

## Testing

| Term | Definition |
|------|-----------|
| **Full Test Suite** | All five suites passing: ESLint, web unit (vitest), API integration (`test:integration:full:host`), E2E bypass, E2E oauth. See [rule](../.claude/rules/full-test-suite.md). |
| **E2E Bypass** | Playwright tests running with `AUTH_MODE=dev_bypass` and `PERSISTENCE_BACKEND=memory`. Standard E2E suite in `specs/`. |
| **E2E OAuth** | Playwright tests running with real `AUTH_MODE=oauth`. Lives in `specs-oauth/`. Tests route protection and session flows. |
| **Auth Mode Override** | `vi.mock("@tw-portfolio/config")` pattern setting `AUTH_MODE=oauth` at test-file level for API integration tests needing OAuth enforcement. |
| **Route Protection Test** | Test asserting unauthenticated requests redirect to `/login`. Must be in `specs-oauth/` (not `specs/`). |
| **Mock OAuth** | CI E2E path using hardcoded subject (`e2e-ci-google-sub-001`) instead of real Google credentials. |

## Project Conventions

| Term | Definition |
|------|-----------|
| **KZO** | Linear ticket prefix for tw-portfolio (e.g., KZO-77, KZO-107). |
| **Policy Authority** | Nearest `AGENTS.md` file, walked up from the touched file's directory to repo root. Canonical source for build commands, code style, testing. |
| **Frozen Snapshot** | Doc in `docs/notes/` that is never updated after merge. Records what was true at that point in time. |
| **Evergreen Doc** | Doc updated in-place to reflect current state (e.g., runbook, architecture, this glossary). |
| **Route Error** | `routeError(statusCode, code, message)` from `apps/api/src/lib/routeError.ts`. Used in service files instead of plain `throw new Error()`. |
| **Workspace Library** | Internal npm package (`libs/domain`, `libs/config`, `libs/shared-types`). Built before apps, not published. |
| **Tenancy Root** | `users.id` anchoring all of a user's data across accounts, fees, trades, dividends. |

---

## Related Docs

- [Architecture](./architecture.md) — system structure and data flow
- [Environment Variables](./environment-variables.md) — all env vars and schemas
- [Auth and Session](./auth-and-session.md) — auth modes, OAuth, demo, cookies
- [Backend Dossier](./backend-db-api-architecture-dossier.md) — DB schema and API routes
- [Runbook](./runbook.md) — operational procedures
