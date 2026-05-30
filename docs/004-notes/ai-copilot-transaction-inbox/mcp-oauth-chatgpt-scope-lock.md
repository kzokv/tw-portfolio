# MCP OAuth ChatGPT Connector Scope Lock

Date: 2026-05-23

## Status

This document locks the implementation scope for the ChatGPT MCP OAuth connector work. The implementation branch is `codex/mcp-oauth-chatgpt`, created from latest `origin/dev`.

Before this branch, the MCP foundation exposed `/mcp`, protected-resource metadata, connector policy, connector access logs, draft tools, and dev-token bearer auth. ChatGPT could not connect because the deployed MCP server did not implement OAuth authorization-server metadata, authorization code + PKCE, token issuance, or OAuth bearer-token validation.

## Gap And Contradiction Check

### Critical gaps resolved

- **ChatGPT requires OAuth, current MCP auth is dev-token only.** Implement a real OAuth 2.1 facade for ChatGPT instead of metadata-only changes.
- **Token signing secret was initially described as user configurable.** Resolved to admin-only encrypted global app setting.
- **Connector lifetime vs browser session expiry.** Browser session only gates authorize/consent. Issued connector tokens live independently until connector expiry, refresh-token failure/reuse, explicit revocation, admin policy, user deactivation/deletion, or account security reset.
- **Account security reset invalidation.** Access/refresh flows include and enforce user `sessionVersion`; refresh mismatch revokes the connector and returns `invalid_grant`.
- **Connection creation timing contradiction.** Create a `pending` connector after consent approval, activate it only after successful token exchange, and allow pending cleanup.
- **Runtime policy vs token claims.** Global policy and connector settings always override token claims on refresh and MCP tool calls.
- **Public metadata origin.** Use a configured public API issuer/origin, not request-header inference except as local/dev fallback.
- **Expired active connector rows can block reconnect.** Scope includes fixing Postgres active-row uniqueness by expiring stale rows before creating a new active/pending ChatGPT connector.

### Non-critical gaps

- **Exact ChatGPT product labels can drift.** Runbook uses current generic labels and points at official OpenAI docs.
- **Refresh-token race behavior.** Reuse detection revokes the connector immediately; no grace window in this phase.
- **Key rotation depth.** The implementation uses a single active signing/hash secret. Rotating or clearing it revokes active and pending ChatGPT connectors instead of maintaining a compatibility window.
- **Pending cleanup worker cadence.** Implement a safe purge path or service helper; cron cadence can be tuned after first release.
- **Self-hosted token mode.** Keep existing dev-token local testing. Production self-hosted personal tokens are out of this scope.

## Locked Decisions

- OAuth model: ChatGPT/CIMD public client, no client secret.
- Redirect validation: allow the known ChatGPT OAuth callback URIs (`https://chat.openai.com/aip/oauth/callback`, `https://chatgpt.com/aip/oauth/callback`) plus GPT-scoped variants (`/aip/<gpt-id>/oauth/callback` on both ChatGPT hosts); tests and local development allow localhost redirects.
- Resource/audience: full public MCP URL, for example `https://vakwen-dev-api.kzokvdevs.dpdns.org/mcp`.
- OAuth issuer: configured public API origin; resource is `${issuer}/mcp`.
- Consent: API-owned OAuth endpoints redirect to a Next.js consent page after Vakwen login.
- Pending authorize state: server-side opaque request id; no raw OAuth transaction data in the consent URL.
- Consent CSRF: one-time token bound to the pending request and authenticated session.
- Scope grants: user grants a subset of requested scopes, intersected with current global group toggles; write requires explicit opt-in.
- Connector lifetime: user chooses a lifetime bounded by admin max connector lifetime.
- Token shape: signed short-lived access token plus opaque hashed rotating refresh token.
- Token lifetimes: auth code 10 minutes, access token 15 minutes, refresh token bounded by connector expiry.
- Refresh reuse: revoke connector, audit, and return `invalid_grant`.
- Browser session expiry: does not revoke connector tokens after consent.
- Security reset: session-version mismatch revokes connector on refresh and rejects access-token use.
- Denial: redirect back to ChatGPT with OAuth error and original `state`; no connector is created.
- Settings UI: show pending connectors distinctly and allow cleanup/revoke.

### Initial scope matrix

| Scope | Capability | Phase-1 default | User-deselectable |
|---|---|---|---|
| `portfolio:mcp_read` | Read portfolio, holdings, transaction context, and connector-safe summaries | Enabled when global MCP read tools are enabled | No |
| `transaction_draft:create` | Create draft transaction candidates for user review | Disabled unless admins enable write/draft tools | Yes |
| `transaction_draft:edit` | Update draft transaction candidates before user review | Disabled unless admins enable write/draft tools | Yes |

### Auth knob boundaries

| Knob | Owner | Effect |
|---|---|---|
| Stable `SESSION_SECRET` | Deployment environment | Required for normal Vakwen web login during authorize/consent. Rotation signs users out and can interrupt in-progress consent, but does not revoke already issued ChatGPT connector tokens. |
| MCP OAuth token secret | Admin global setting | Signs MCP access tokens and hashes OAuth codes/refresh tokens. Rotation or clearing revokes pending and active ChatGPT connectors. |
| User session-version reset | User/account security control | Revokes ChatGPT connectors on refresh or access-token validation because connector tokens carry the session version from consent time. |

## Implementation Scope

### API and auth

- Add OAuth authorization-server metadata at `/.well-known/oauth-authorization-server`.
- Update protected-resource metadata to advertise the configured authorization server.
- Add `WWW-Authenticate: Bearer resource_metadata="..."` on unauthenticated MCP requests.
- Add `GET /oauth/authorize`.
- Add consent pending-request APIs for the web app.
- Add consent approve/deny APIs.
- Add `POST /oauth/token` for authorization-code and refresh-token grants.
- Validate exact `resource`, strict redirect URI, `client_id`, one-time auth code, and PKCE S256.
- Issue signed access tokens with `kid`, `iss`, `aud`, `sub`, `connectionId`, `sv`, `scope`, `iat`, `exp`, and `jti`.
- Validate OAuth access tokens in MCP auth and keep current dev-token support for local/self-hosted smoke testing only.
- Enforce user status, connector status, connector expiry, session version, global policy, provider policy, scopes, share capabilities, tool toggles, and rate limits on every MCP request.

### Persistence and migrations

- Add `pending` status to `ai_connector_connections`.
- Add pending OAuth authorization request storage.
- Add hashed one-time authorization code storage.
- Extend `ai_connector_credentials` for refresh-token rotation with replacement/revocation/reuse detection fields.
- Add admin encrypted global setting for the MCP OAuth token secret.
- Add admin setting for public OAuth issuer/API origin; production requires an explicit HTTPS issuer.
- Add global max connector lifetime setting.
- Preserve memory and Postgres backend parity.

### Web UI

- Add Next consent page at `/connectors/chatgpt/authorize?requestId=...`.
- Show provider, requested scopes, user-selectable granted scopes, connector lifetime, expiry, and policy constraints.
- Add approve/deny actions with one-time CSRF token.
- Update Settings -> AI Connectors for pending state and cleanup/revoke action.
- Update Admin -> Settings -> MCP for public issuer, max connector lifetime, and encrypted MCP OAuth token secret.
- Keep a stable app `SESSION_SECRET` configured for OAuth-capable MCP deployments because ChatGPT consent depends on the normal Vakwen login session.

### Documentation

- Keep `docs/002-operations/runbook.md` as the evergreen operations guide for bringing up MCP and configuring ChatGPT.
- Keep this scope lock as implementation handoff and acceptance reference.
- Include mockup screenshots under `docs/004-notes/ai-copilot-transaction-inbox/mockups/`.

## UI Mockups

The implementation should follow the existing quiet settings/admin visual language: compact panels, low-radius controls, dense but legible information hierarchy, and explicit action states.

- ChatGPT consent screen: `docs/004-notes/ai-copilot-transaction-inbox/mockups/mcp-oauth-consent.png`
- User connector settings: `docs/004-notes/ai-copilot-transaction-inbox/mockups/mcp-oauth-settings.png`
- Admin MCP OAuth settings: `docs/004-notes/ai-copilot-transaction-inbox/mockups/mcp-oauth-admin.png`
- ChatGPT-side connector setup reference: `docs/004-notes/ai-copilot-transaction-inbox/mockups/mcp-oauth-chatgpt-setup.png`
- Source HTML for screenshot regeneration: `docs/004-notes/ai-copilot-transaction-inbox/mockups/mcp-oauth-mockups.html`

## Non-Goals

- ChatGPT app UI component.
- Dynamic Client Registration.
- Confidential OAuth clients/client secrets.
- Production self-hosted personal connector tokens.
- Final transaction posting over MCP.
- Admin impersonation over MCP.
- Public anonymous share access over MCP.
- Moving Google login/session semantics.

## Acceptance Tests

- Protected-resource metadata advertises the configured authorization server and resource.
- Authorization-server metadata advertises authorization/token endpoints, public-client token auth, PKCE S256, authorization-code and refresh-token grants, and CIMD support.
- `/oauth/authorize` rejects invalid resource, redirect URI, response type, PKCE method, and unsupported scopes.
- Unauthenticated authorize redirects through normal Vakwen login and returns to consent.
- Consent approval creates a pending connector and one-time auth code.
- Consent denial redirects to ChatGPT with OAuth error and original state.
- `/oauth/token` exchanges a valid code once, activates the connector, issues access + refresh tokens, and rejects replay.
- Refresh rotates refresh token, invalidates the old token, and rejects old-token reuse by revoking the connector.
- Session-version mismatch during refresh revokes the connector.
- MCP accepts signed OAuth access tokens and rejects expired, wrong-audience, wrong-issuer, revoked, inactive, or policy-disabled tokens.
- Existing dev-token MCP smoke tests remain local/test-only and continue to pass.
- Postgres reconnect after an expired ChatGPT connector does not fail the active-provider unique index.
- Settings UI renders pending, active, revoked, and expired connectors correctly.
- Admin UI stores MCP OAuth token secret encrypted and never echoes plaintext.
- Full repo gates must pass before PR: lint, typecheck, web unit, API tests, host integration, bypass E2E, OAuth E2E, and API HTTP tests.

## Tier Recommendation

**Task:** Implement ChatGPT OAuth for the Vakwen MCP connector.

**Recommended tier:** Tier 3 (Full Team).

| Signal | Assessment | Score |
|---|---|---|
| Files changed | Expected 20+ files across API, web, migrations, shared types, docs, and tests | Tier 3 |
| Layers touched | API auth, persistence, DB migrations, config, web UI, docs, unit/integration/E2E tests | Tier 3 |
| Spec complexity | Multi-story OAuth/security feature with consent, token rotation, runtime policy, and UI | Tier 3 |
| Risk | High: external auth, bearer tokens, revocation, account security reset, and ChatGPT integration | Tier 3 |

Expected teammates for a Tier 3 run: architect, backend implementer, frontend implementer, QA, dispatcher, validator, reviewer, and writer.

Why not Tier 2: OAuth token issuance, rotation, migration safety, and consent UI are cross-cutting and security-sensitive.

Why not more than Tier 3: Scope is now locked to one connector provider and one public-client OAuth model; no DCR, confidential clients, or ChatGPT app component.

Estimated team cost: approximately $15-40 for the first team run; each extra iteration adds roughly 30-50%.
