---
name: API route surface and data flow
description: HTTP API endpoints, auth model, persistence write paths, and web-consumed surface for the Fastify backend
type: reference
---

## Auth Model
- `AUTH_MODE=oauth`: `resolveUserId` accepts `x-authenticated-user-id` header (gateway/proxy) or HMAC-signed session cookie (direct browser); missing both returns 401
- `AUTH_MODE=dev_bypass`: optional `x-user-id`, defaults to `user-1`

## Route Surface

### Health
- `GET /health/live` — liveness
- `GET /health/ready` — Postgres + Redis health check

### User Profile
- `GET /profile` — returns `ProfileDto` (auth-guarded; userId, email, displayName, providerPictureUrl, providerDisplayName, linkedAt, lastSeenAt)
- `PATCH /profile` — update mutable email, returns updated `ProfileDto` (auth-guarded, Zod-validated)

### Settings & Fee Config
- `GET /settings` — UserSettings (web-consumed)
- `PATCH /settings` — partial update
- `PUT /settings/full` — full settings save with draft reconciliation (web-consumed)
- `GET /settings/fee-config` — accounts + profiles + bindings + integrity (web-consumed)
- `PUT /settings/fee-config` — update fee config

### Accounts, Fee Profiles, Bindings
- `GET /accounts`, `PATCH /accounts/:id`
- CRUD `/fee-profiles` (delete protected: can't delete last, in-use, or snapshot-referenced)
- `GET/PUT /fee-profile-bindings`

### Portfolio
- `POST /portfolio/transactions` — idempotent trade posting (web-consumed)
- `GET /portfolio/transactions` — list trades
- `GET /portfolio/holdings` — computed holdings (web-consumed)

### Dividends & Corporate Actions
- `POST /dividend-events`, `GET /dividend-events`
- `POST /portfolio/dividends/postings` — idempotent dividend posting
- `GET /portfolio/dividends/ledger`
- `POST /corporate-actions`, `GET /corporate-actions`

### Recompute & Quotes
- `POST /portfolio/recompute/preview` (web-consumed)
- `POST /portfolio/recompute/confirm` (web-consumed)
- `GET /quotes/latest` — Redis-cached, mock providers currently

### AI
- `POST /ai/transactions/parse` — local text parser
- `POST /ai/transactions/confirm` — batch trade creation

## Persistence Write Paths
- **Incremental**: `savePostedTrade` (trade+snapshot+cash+lots), `savePostedDividend`
- **Full rewrite**: `saveStore` (users+profiles+accounts+overrides+recompute → `saveAccountingStoreTx` full delete/reinsert of all accounting tables)

## Web-Consumed Routes (shipped UI)
`GET /profile` (via Next.js proxy), `PATCH /profile` (via Next.js proxy), `GET /settings`, `GET /settings/fee-config`, `GET /portfolio/holdings`, `PUT /settings/full`, `POST /portfolio/transactions`, `POST /portfolio/recompute/preview`, `POST /portfolio/recompute/confirm`

## Next.js API Proxy Routes (`apps/web/app/api/`)
- `GET /api/profile` — server-side proxy: validates session via `getSession()`, returns 401 JSON if absent, forwards to `GET /profile` with `x-authenticated-user-id` header
- `PATCH /api/profile` — server-side proxy: validates session, forwards body to `PATCH /profile`
- Frontend calls relative `/api/profile` URLs; session auth is handled server-side to avoid CORS
