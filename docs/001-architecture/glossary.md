# Glossary

Curated domain terms, project conventions, and system concepts used throughout the tw-portfolio codebase and documentation.

---

## Accounting and Portfolio

| Term | Definition |
|------|-----------|
| Booked fact | An accounting record persisted in the database (trade event, cash ledger entry, dividend ledger entry). For audit-grade systems, corrections use reversals. For user-owned MVP portfolios, trade events also support hard delete and inline edit (KZO-114) — see Practical Mutation Model in `canonical-accounting-model.md`. |
| Derived state | Computed projections rebuilt from booked facts: lots, lot allocations, holdings, daily portfolio snapshots. Can be regenerated from facts at any time. |
| Reference data | Slowly changing configuration: users, accounts, fee profiles, symbols. Not accounting facts but required context for booking. |
| Reversal | A corrective record that negates a prior booked fact. Uses a self-FK (`reversal_of_*_id`) linking back to the original row. |
| Trade event | A canonical buy or sell record in `trade_events`. Each trade captures quantity, price, fees, taxes, and links to a fee policy snapshot. |
| Trade fee policy snapshot | An immutable copy of the fee profile values at trade booking time, stored in `trade_fee_policy_snapshots`. Ensures historical trades retain their original fee computation regardless of later profile edits. |
| Lot | A weighted-average inventory position for an account+symbol, stored in `lots`. Tracks open quantity and total cost. |
| Lot allocation | A per-sell mapping from a trade event to the contributing lots, stored in `lot_allocations`. Records how much quantity and cost was consumed from each lot. |
| Weighted average | The single supported cost-basis method. All lots for an account+symbol share one blended cost basis, updated on each buy. |
| Dividend event | An ex-date/payment-date announcement for a symbol, stored in `dividend_events`. Independent of accounts. |
| Dividend ledger entry | A per-account posting for a dividend event, stored in `dividend_ledger_entries`. Tracks eligible quantity, expected amounts, posting status, and reconciliation status. |
| Eligible quantity | The number of shares held on the ex-dividend date, used to compute expected dividend amounts. |
| Fee profile | A named set of broker fee/tax rates (`fee_profiles`). Accounts reference a default profile; per-symbol overrides are stored in `account_fee_profile_overrides`. |
| Fee profile binding | A per-account+symbol override that selects a different fee profile than the account default. Stored in `account_fee_profile_overrides`. |
| Instrument type | The classification of a tradable symbol: `STOCK`, `ETF`, or `BOND_ETF`. Determines which tax rate applies to sells. |
| Day trade | A same-day buy+sell (or sell+buy) for the same symbol and account. Subject to a different tax rate than regular trades. |
| Booking sequence | A per-account+trade-date ordering key that ensures deterministic trade ordering within a single day. Compacted (gap-filled) after a trade's date is changed via PATCH. |
| Fees source | The `fees_source` column on `trade_events` (migration `016`). `CALCULATED` means fees were auto-derived from the bound fee profile and will be recalculated on PATCH if quantity or price changes. `MANUAL` means fees were user-supplied; PATCH prompts for confirmation before recalculating. |
| Cascade recompute | The async post-mutation process triggered after a trade delete or edit. `replayPositionHistory` replays all trade events for the affected account+symbol in chronological order to rebuild lots, lot allocations, and cash settlement entries. Completes asynchronously and publishes `recompute_complete` or `recompute_failed` via SSE. |
| replayPositionHistory | The service function (`apps/api/src/services/replayPositionHistory.ts`) that implements cascade recompute. Deletes all lots, lot allocations, and trade settlement cash entries for an account+symbol, then replays all remaining trade events in trade_date + booking_sequence order to produce a fresh derived state. |
| scheduleReplayWithRetry | The async wrapper around `replayPositionHistory` that runs in `setImmediate` with one automatic retry. On first failure, publishes `recompute_failed` with `retriesExhausted: false`. On retry success, publishes `recompute_complete`. On retry failure, publishes `recompute_failed` with `retriesExhausted: true`. |
| ReplayError | Custom error class thrown by `replayPositionHistory` when a trade cannot be replayed (e.g., a SELL with insufficient open quantity). Carries `failedTradeEventId` for targeted error reporting in the `recompute_failed` SSE payload. |
| Reconciliation status | State of a dividend ledger entry: `open`, `matched`, `explained`, or `resolved`. Tracks whether the expected amount matches the actual received amount. |
| Recompute job | A preview/confirm workflow that recalculates fees and taxes for existing trades using a different fee profile. Stored in `recompute_jobs` and `recompute_job_items`. |
| Cash ledger entry | A canonical cash movement record in `cash_ledger_entries`. Types include trade settlement, dividend receipt, dividend deduction, manual adjustment, and reversal. |
| Corporate action | A stock split, reverse split, or dividend declaration stored in `corporate_actions`. Splits mutate open lot quantities in place using floor rounding. |
| Daily portfolio snapshot | A stored daily projection in `daily_portfolio_snapshots` capturing NAV, market value, cost, unrealized/realized PnL, dividends, and cash balance. Schema exists but not actively generated by current runtime. |
| Posting status | State of a dividend ledger entry lifecycle: `expected` (computed from eligible quantity), `posted` (actual amounts received), or `adjusted` (corrected after posting). |
| Store | The in-memory `Store` object loaded by `loadStore(userId)` containing all user settings, accounts, fee profiles, and accounting facts/projections. Mutated first, then persisted. |

## Fees and Taxation

| Term | Definition |
|------|-----------|
| BPS | Basis points — one hundredth of a percent (0.01%). Commission and tax rates are stored in BPS (e.g., 1425 BPS = 0.1425%). |
| Board commission | The standard broker commission rate set by the exchange or regulator, expressed in BPS. |
| Commission discount percent | A percent-off discount from the board commission rate offered by the broker. Stored as `NUMERIC(5,2)` — e.g., `28.00` means a 28% discount off the board rate. |
| Rounding mode | How fractional fee/tax amounts are resolved: `FLOOR` (round down), `ROUND` (half-up), or `CEIL` (round up). Separate modes for commission and tax. |
| Sell tax rate | The transaction tax applied to sell trades, expressed in BPS. Varies by instrument type: separate rates for stock, ETF, bond ETF, and day-trade stock. |
| Minimum commission | The floor amount for broker commission. If the calculated commission is below this value, the minimum is used instead. Stored in integer TWD cents. |

## Authentication and Session

| Term | Definition |
|------|-----------|
| Auth mode | The `AUTH_MODE` setting that selects the authentication strategy: `dev_bypass` (hardcoded identity) or `oauth` (Google OAuth + session cookies). |
| HMAC session cookie | The session token format: `{userId}.{hmacSha256Signature}`. Signed with `SESSION_SECRET`; verified on every request in `oauth` mode. |
| `__Host-` prefix | A cookie prefix that requires `Secure=true`, `Path=/`, and no `Domain` attribute. Used in HTTPS deployments for maximum cookie security. Dropped for HTTP environments. |
| Cookie domain | The `COOKIE_DOMAIN` setting that enables cross-subdomain cookie sharing. Set to `.example.com` to share cookies between `twp-web.example.com` and `twp-api.example.com`. |
| Demo mode | A feature that allows anonymous users to try the app without Google sign-in. Creates temporary demo users with seeded portfolio data. |
| Demo user | A temporary user created by `POST /auth/demo/start` with `is_demo=true` and a TTL. Cleaned up by a periodic background job. |
| External identity | A record in `user_external_identities` linking a user to an OAuth provider (e.g., Google). Stores `provider`, `provider_subject`, email, and display name. |
| Provider subject | The unique user identifier from an OAuth provider (the `sub` claim in Google's ID token). Used with `provider` as the unique key for external identities. |
| `resolveOrCreateUser` | The API function that performs email-based identity resolution: finds an existing user by email or creates a new one, then links/updates the external identity and seeds default portfolio data. |
| `resolveUserId` | The route-level function in `registerRoutes.ts` that extracts user identity from the session cookie (oauth mode) or defaults to `user-1` (dev_bypass mode). |
| E2E session seeding | The `POST /__e2e/oauth-session` endpoint (non-production only) that creates a session cookie for a test user without going through Google OAuth. |
| Admin impersonation | A time-limited, audit-logged, read-only mode (KZO-148) where an admin views the app as another user. `sessionUserId` remains the admin; `contextUserId` becomes the target. All writes are blocked at the `enforceRouteRole` preHandler with `403 impersonation_write_blocked`. See [Auth — Admin Impersonation](./auth-and-session.md#admin-impersonation-kzo-148). |
| Impersonation cookie | The `g_impersonation` HMAC-signed cookie that carries `{adminId}.{targetUserId}.{expiresAtMs}`. Signed with `SESSION_SECRET`, parallel to the session cookie. TTL configurable via `ADMIN_IMPERSONATION_TTL_MINUTES`. |
| Impersonation write-block | The blanket preHandler rule: when `isImpersonating=true`, any `POST/PUT/PATCH/DELETE` is rejected with `403 impersonation_write_blocked` and audited. Only `POST /admin/users/:id/impersonate` and `DELETE /admin/impersonation` are allowlisted. |

## Environment and Configuration

| Term | Definition |
|------|-----------|
| Env schema | A Zod schema that validates environment variables at startup. `envSchema` for the API, `webEnvSchema` for the web middleware. |
| Env setup target | One of `root:local`, `docker:local`, `docker:dev`, `docker:prod` — determines which env file is generated and which schema validates it. |
| Context tag | The `[context]` annotation in `.env.example` that indicates which deployment contexts use a variable (e.g., `[all]`, `[docker:cloud]`, `[root:local]`). |
| Edge Runtime | The V8-based serverless runtime used by Next.js middleware. Cannot import Node.js modules. Uses `env-web.ts` (not `env.ts`) for configuration. |
| `NEXT_PUBLIC_*` | Next.js convention for client-exposed env vars. Values are inlined into the JavaScript bundle at **build time** — changing them requires a rebuild. |
| `SERVER_API_BASE_URL` | The container-internal API URL used by Next.js SSR route handlers (e.g., `http://twp-prod-api:4000`). Avoids hairpinning through the public internet. |
| Persistence backend | The `PERSISTENCE_BACKEND` setting: `postgres` for real SQL storage or `memory` for in-process test/dev storage. |
| Deploy env | The `DEPLOY_ENV` setting: `local`, `dev`, or `production`. Selects the compose file and env file pair. |
| Web build arg | A Docker build argument (`ARG`) that inlines `NEXT_PUBLIC_*` values into the Next.js client bundle at image build time. Must also be set in compose `environment` for server-side runtime access. |

## Infrastructure and Deployment

| Term | Definition |
|------|-----------|
| Cloudflare Tunnel | An outbound tunnel from the QNAP host to Cloudflare that publishes internal services to the internet without opening inbound firewall ports. |
| WARP | Cloudflare's client VPN used by the GitHub Actions runner to reach the private deploy host during CI/CD. |
| `cloudflared` | The Cloudflare daemon that runs inside a Docker container on the QNAP host, maintaining the tunnel connection to Cloudflare's edge. |
| Compose profile | A Docker Compose feature that groups optional services. The `migrate` profile includes the migration container, built only when `--profile migrate` is specified. |
| Container network | The isolated Docker bridge network (`twp-prod-net`, `twp-dev-net`, `twp-local-net`) that allows containers within an environment to communicate. |
| Port offset | The +300 offset applied to local Docker host ports (e.g., 3000 -> 3300, 4000 -> 4300) to avoid collision with host-level dev servers. |
| Hairpinning | When a container routes through the public internet to reach another container in the same network. Avoided by using `SERVER_API_BASE_URL` for container-to-container calls. |
| Project prefix | The Docker Compose project name (`twp-local`, `twp-dev`, `twp-prod`) that namespaces all container names and networks for an environment. |
| `deploy.sh` | The shared deploy script at `infra/scripts/deploy.sh` that orchestrates checkout, build, backup, migrate, deploy, and health check phases. |
| Health check | The post-deploy verification: API `/health/live` (30s timeout) and Web `/` (20s timeout). Failure triggers automatic rollback. |
| Idempotency key | A Redis-backed key used by `POST /portfolio/transactions` and `POST /portfolio/dividends/postings` to prevent duplicate writes. Claimed before persistence, released on failure. |
| Rollback | The automatic recovery procedure triggered when a deploy health check fails: restores previous branch/SHA, rebuilds images, restores DB from pre-migration backup, restarts containers. |
| Image tag | The Docker image tag applied to app images. Default: short git SHA. CI deploys use `latest`. Set via `--image-tag` option on `deploy.sh`. |
| Advisory lock | A Postgres-level lock acquired before running migrations, preventing concurrent migration runners from conflicting. Both the API startup path and the migrate container use the same lock. |

## SSE Events

| Term | Definition |
|------|-----------|
| `recompute_complete` | SSE event type published after a successful `replayPositionHistory`. Payload: `{ accountId, symbol, updatedHoldings: { openQuantity, averageCost, totalRealizedPnl, totalCommission, totalTax }, cashBalanceChange, lotsRecalculated, affectedTradeCount }`. |
| `recompute_failed` | SSE event type published when `replayPositionHistory` throws (e.g., negative lots). Payload: `{ accountId, symbol, reason, retriesExhausted: boolean }`. `retriesExhausted: false` on first failure; `retriesExhausted: true` when the automatic retry also fails. |

## Database and Persistence

| Term | Definition |
|------|-----------|
| Full-store rewrite | The `saveStore` + `saveAccountingStoreTx` path that deletes and reinserts all accounting rows from the in-memory store. Used by settings save, recompute, corporate actions, and AI confirm. |
| Incremental write | The `savePostedTrade` / `savePostedDividend` path that inserts only the new rows for a single trade or dividend posting without touching other data. |
| Load store | The `loadStore(userId)` function that reads all user data from Postgres into an in-memory `Store` + `AccountingStore` object for mutation. |
| Migration | A numbered SQL file in `db/migrations/` applied by the migration runner. Each migration is recorded in `schema_migrations`. |
| Baseline schema | `db/migrations/baseline_current_schema.sql` — a consolidated schema for fresh databases that supersedes migrations 001–010. |
| Dormant table | A table that exists in the schema but has no current runtime read/write code (e.g., `reconciliation_records`). |
| Soft delete | A deletion pattern using timestamp columns (`deactivated_at`, `deleted_at`) instead of row removal. Used on `users`. |
| Schema migrations table | The `schema_migrations` table that records which numbered migration files have been applied. Source of truth for the migration runner. |
| Manifest env | The `db/migrations/manifest.env` file that declares which numbered migration files are superseded by the baseline schema for fresh installs. |

## Testing

| Term | Definition |
|------|-----------|
| Full test suite | The seven required test suites: (1) lint, (2) typecheck, (3) web unit, (4) API integration, (5) E2E bypass, (6) E2E OAuth, (7) API HTTP. All must pass before declaring "tests pass." |
| E2E bypass | Playwright E2E tests running with `AUTH_MODE=dev_bypass` and `PERSISTENCE_BACKEND=memory`. Tests in `specs/`. |
| E2E OAuth | Playwright E2E tests running with `AUTH_MODE=oauth`. Tests in `specs-oauth/`. Uses `/__e2e/oauth-session` for session seeding. |
| API HTTP tests | Playwright-based API contract tests running with `AUTH_MODE=oauth`, API-only (no web server). Tests in `apps/api/test/http/specs/`. Uses `libs/test-api` assistants. |
| Auth mode override | A `vi.mock("@tw-portfolio/config")` pattern used in API tests to switch `AUTH_MODE` to `oauth` for tests that need session enforcement. |
| Route protection test | A test that clears cookies, visits a protected page, and asserts redirect to `/login`. Must be placed in `specs-oauth/`, not `specs/`. |
| Mock OAuth | The E2E test pattern where `/__e2e/oauth-session` creates a real session cookie without contacting Google, simulating an authenticated user. |
| Integration test (host mode) | API integration tests run with `test:integration:full:host` against an isolated Postgres/Redis Docker stack, using host-network port routing. |

## AAA Test Framework

| Term | Definition |
|------|-----------|
| AAA pattern | Arrange-Act-Assert — the three-phase test structure used across all E2E and API HTTP specs. Each phase has a dedicated class per feature. |
| Triplet | The three assistant classes (Arrange, Actions, Assert) for a feature. Created via a factory function registered in the assistant registry. |
| Assistant | A triplet instance (e.g., `DashboardArrange`, `DashboardActions`, `DashboardAssert`) that encapsulates test behavior for one feature. |
| Page Object Model (POM) | A `BasePage<TElements>` subclass in `libs/test-e2e` that defines locators with human-readable descriptions. POMs are vocabulary-only — no behavior logic. |
| Endpoint descriptor | A `BaseEndpoint` subclass in `libs/test-api` that defines HTTP methods (GET, POST, PATCH, DELETE). Returns raw `APIResponse` — no response parsing. |
| Fixture chain | The Playwright `test.extend()` chain: `base.ts` (TestUser) → domain fixture (assistant) → spec file. Typed dependency flow from base through domain. |
| TestUser | The shared orchestrator holding identity, page/request references, and the assistant cache. Creates assistants via `useWebAssistant()` / `useApiAssistant()`. `reset()` clears all client-side state. |
| `@Step()` decorator | Applied to all public assistant methods. Wraps with `test.step()` in test context, falls back to console logger in global-setup. Produces human-readable Playwright trace labels. |
| Mixin | A composable behavior unit (`CoreMixin`, `ArrangeMixin`, `ActionsMixin`, `AssertMixin`) mixed into AAA base classes. Diamond composition is intentional. |
| `libs/test-framework` | Generic, app-agnostic AAA core — base classes, mixins, actions, logging, decorators, assistant registry. Shared by both `test-e2e` and `test-api`. |
| `libs/test-e2e` | App-specific web E2E layer — page objects, web assistants, Playwright fixtures. Consumes `test-framework`. |
| `libs/test-api` | App-specific API HTTP layer — endpoint descriptors, API assistants, Playwright fixtures. Consumes `test-framework`. Sibling of `test-e2e` (never imports from it). |
| Assistant factory registry | Module-level singleton Maps (`webAssistantRegistry`, `apiAssistantRegistry`) that map Page/Endpoint constructors to triplet factory functions. Idempotent registration, `_reset()` for test isolation. |

## Project Conventions

| Term | Definition |
|------|-----------|
| KZO | The Linear project prefix for tw-portfolio tickets (e.g., KZO-77, KZO-78). |
| Policy authority | The nearest `AGENTS.md` file walking up from a touched file's directory. Contains build commands, code style, testing, and security rules. |
| Frozen snapshot | A document in `docs/004-notes/` that records what was true at a specific point in time. Never updated after merge. |
| Evergreen doc | A document in `docs/001-architecture/` or `docs/002-operations/` that is updated in place to reflect the current system state. |
| Route error | The `routeError(statusCode, code, message)` pattern from `apps/api/src/lib/routeError.ts`. Always used instead of plain `throw new Error()` in service files. |
| Workspace library | An npm workspace package under `libs/` (`@tw-portfolio/config`, `@tw-portfolio/domain`, `@tw-portfolio/shared-types`, `@tw-portfolio/test-framework`, `@tw-portfolio/test-e2e`, `@tw-portfolio/test-api`). Must be built before consuming apps/tests. |
| Tenancy root | The `users.id` column — the top-level key that scopes all user-owned data. Every query filters by user ID. |
| ADR | Architecture Decision Record — a numbered document in `docs/003-adr/` that records a specific architectural decision and its rationale. Append-only. |
| Transition guide | A document written at the end of a change arc that describes behavioral changes, migrations, or removals. Placed as the final numbered doc in a `docs/004-notes/` series. |

---

## Related Docs

- [System Architecture](./architecture.md)
- [Auth and Session](./auth-and-session.md)
- [Backend, DB & API](./backend-db-api.md)
- [Web Frontend](./web-frontend.md)
- [Canonical Accounting Model](./canonical-accounting-model.md)
- [Environment Variables](../002-operations/environment-variables.md)
- [CI/CD](../002-operations/ci-cd.md)
- [Runbook](../002-operations/runbook.md)
