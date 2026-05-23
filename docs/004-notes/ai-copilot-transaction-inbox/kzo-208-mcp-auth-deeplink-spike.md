---
slug: kzo-208
type: spike
created: 2026-05-21T18:40
tickets: [KZO-208]
---

# KZO-208 - ChatGPT MCP Auth And Deep-Link Spike

> Superseded detail: this spike captured an early ChatGPT callback shape. The implemented connector now uses the callback allowlist documented in `docs/002-operations/runbook.md` and `mcp-oauth-chatgpt-scope-lock.md`: `https://chat.openai.com/aip/oauth/callback`, `https://chatgpt.com/aip/oauth/callback`, and their `/aip/<gpt-id>/oauth/callback` variants.

## Outcome

ChatGPT/MCP is viable for the AI Copilot & Transaction Inbox v1, with one important constraint: the hosted ChatGPT app path should be OAuth 2.1, not a raw personal-token connector. Self-hosted token mode is feasible for API/local MCP clients and limited self-hosted testing, but ChatGPT's first-class authenticated app flow expects OAuth metadata and authorization-code + PKCE.

Recommended first implementation:

- Add a hosted HTTPS MCP endpoint in `apps/api`, initially `/mcp`.
- Use the stable `@modelcontextprotocol/sdk` v1.x package for the first production cut; avoid the v2 split packages until they leave alpha.
- Implement OAuth-protected-resource metadata, OAuth server metadata, token issuance/validation, and connector-scoped permission rows in app persistence.
- Return deep links in tool `structuredContent`/`content`, never tokens: `/transactions?tab=ai-inbox&batch=<batchId>&context=<contextId>`.
- Add web routing support before relying on the link: `TransactionsPage` currently ignores query params, and `apps/web/proxy.ts` currently drops query params when building the login `returnTo`.

## Verified Protocol Facts

OpenAI's current docs call ChatGPT connectors "apps" / "data-only apps"; the MCP contract remains the relevant integration layer. A remote MCP server can be used from ChatGPT and API integrations, and OpenAI documents custom remote servers as Internet-reachable servers implementing MCP.

Transport:

- OpenAI's Responses API supports remote MCP servers using either Streamable HTTP or HTTP/SSE.
- The MCP 2025-11-25 transport spec defines Streamable HTTP as the current standard transport and says it replaces the older HTTP+SSE transport from protocol version 2024-11-05.
- Streamable HTTP requires one MCP endpoint that supports POST and GET. It can optionally use SSE for streaming.
- For v1, use Streamable HTTP unless ChatGPT app testing finds a compatibility issue that requires an `/sse` fallback.

Auth:

- For authenticated Apps SDK MCP servers, OpenAI expects OAuth 2.1 conforming to the MCP authorization spec.
- ChatGPT supports Client ID Metadata Documents, Dynamic Client Registration, predefined OAuth clients, and PKCE.
- The MCP server must expose OAuth protected resource metadata, either at a well-known HTTPS URL or through a `WWW-Authenticate` challenge.
- The authorization server must expose OAuth authorization-server metadata or OIDC discovery metadata.
- ChatGPT sends a `resource` parameter through authorization and token requests; the access token should bind that value, commonly as `aud`, so the MCP server can reject tokens minted for other resources.
- ChatGPT redirects OAuth completion to a `https://chatgpt.com/connector/oauth/{callback_id}` URL shown in the app management page.

Tool response shape:

- Tool results may contain `structuredContent`, `content`, and `_meta`.
- `structuredContent` and `content` are visible to the model and conversation transcript.
- `_meta` is hidden from the model and delivered only to a component; v1 has no ChatGPT UI component, so do not depend on `_meta`.
- OpenAI's MCP guidance says to include structured output in `structuredContent` and mirror it as JSON text in `content` for compatibility.
- Therefore, deep-link responses should include a human-readable `content` summary and a concise `structuredContent.deepLink.url` field.

## Hosted Auth Shape

Use a dedicated connector token model rather than reusing the existing web session cookie.

Required components:

- Resource server: `apps/api` MCP endpoint verifies `Authorization: Bearer <access_token>` on every MCP request.
- Authorization server: either a small OAuth implementation inside `apps/api` or an external IdP configured for this app.
- Discovery:
  - `GET /.well-known/oauth-protected-resource` on the MCP host.
  - `GET /.well-known/oauth-authorization-server` or `GET /.well-known/openid-configuration` on the issuer.
- Token claims:
  - `sub`: Vakwen user id.
  - `aud`: canonical MCP resource URL.
  - `scope`: connector scopes, e.g. `portfolio:mcp_read transaction_draft:create transaction_draft:update`.
  - Connector id/session id for revocation and audit correlation.
  - Expiry matching user/admin connector settings.
- Runtime enforcement:
  - Verify bearer token signature or introspection result.
  - Resolve the connected user as `sessionUserId`.
  - Apply the same portfolio/share context rules as web requests.
  - Apply connector toggles, advanced tool toggles, and share capabilities before each tool call.

Do not authenticate MCP by web cookies. ChatGPT server-side MCP calls will not carry the user's browser cookies, and coupling MCP authorization to browser cookies would also make revocation/auditing weaker.

## Self-Hosted Token Mode

Feasibility: partially feasible, but not the hosted ChatGPT app path.

Viable cases:

- Responses API callers can pass an OAuth-style `authorization` value with the MCP tool configuration on each request.
- Local/self-hosted MCP clients can send `Authorization: Bearer <personal_connector_token>` directly to `/mcp`.
- Internal smoke tests can use a generated connector token against a local/tunnelled HTTPS endpoint.

Not viable as the main ChatGPT app UX:

- OpenAI's Apps SDK auth path for customer-specific data expects OAuth 2.1 plus MCP authorization metadata.
- There is no verified first-class ChatGPT UI flow where a user pastes an arbitrary bearer token and ChatGPT stores/sends it as a connector credential.
- A token-only self-hosted flow would need to be wrapped in an OAuth facade, for example an authorization page where the user enters/creates a token and the server returns an OAuth access token to ChatGPT.

Decision: implement OAuth first. Keep personal connector tokens as an optional self-hosted/admin feature after the OAuth path exists.

## Deep-Link Handoff

Target format:

```text
/transactions?tab=ai-inbox&batch=<batchId>&context=<contextId>
```

Security decision:

- The URL must not contain access tokens, refresh tokens, signed one-time auth tokens, or raw source text.
- `batch` and `context` are opaque ids only.
- The web app must authorize access after navigation using the normal session cookie.
- If the user is not logged in, login should preserve the full path and query, then return to the AI Inbox target.
- If the user's web session is not the same principal as the MCP connector owner, show a forbidden/not-found state rather than leaking batch existence.

Current code gap:

- `apps/web/app/transactions/page.tsx` mounts `TransactionsClient` and does not accept or pass `searchParams`.
- `apps/web/components/transactions/TransactionsClient.tsx` has no `ai-inbox` tab yet.
- `apps/web/proxy.ts` redirects unauthenticated users with `returnTo=pathname`, dropping the original query string.
- `apps/web/lib/auth.ts` also derives `returnTo` from `x-current-path`, which is currently just the pathname.

Implementation prerequisite:

- Preserve `pathname + search` in proxy/header return flows.
- Validate `returnTo` with the existing same-origin relative-path guard.
- Add Transactions page query parsing for `tab`, `batch`, and `context`.
- Load batch details server/client-side only after session authorization.

## SDK And Package Decision

Use stable `@modelcontextprotocol/sdk` v1.x first.

Rationale:

- The repo is TypeScript/Fastify on Node >=24.13.0, so the TypeScript SDK fits the stack.
- OpenAI's current MCP examples still show `@modelcontextprotocol/sdk/server/mcp.js` imports for TypeScript examples.
- npm currently reports `@modelcontextprotocol/sdk@1.29.0` as stable and MIT licensed.
- The official repo has v2 split packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@modelcontextprotocol/fastify`) at `2.0.0-alpha.2`. The Fastify adapter is attractive but alpha.

Implementation approach:

- Build MCP tool definitions in a small `apps/api/src/mcp/` module.
- Register a Fastify route that hands raw request/reply streams to the SDK Streamable HTTP transport.
- Start stateless if ChatGPT tool calls do not require MCP session state; move to stateful only if resumability or notifications become necessary.
- Keep business logic outside MCP registration so API routes and MCP tools reuse the same validation/services.
- Add a narrow adapter for MCP auth context instead of bending existing cookie auth into bearer auth.

Package watchlist:

- Revisit `@modelcontextprotocol/server` + `@modelcontextprotocol/node` + `@modelcontextprotocol/fastify` when v2 becomes stable.
- If v1 Fastify raw stream integration proves brittle, consider a dedicated MCP sub-app or Express sidecar only for `/mcp`, but keep all domain logic in shared service modules.

## Risks

- **OpenAI product surface is moving.** Terminology changed from connectors to apps; exact app-management screens and requirements can shift.
- **OAuth implementation scope is non-trivial.** If we do not use an external IdP, `apps/api` must implement enough OAuth metadata, authorization code, PKCE, token, revocation, and consent behavior to satisfy ChatGPT.
- **SDK package churn.** Stable v1 and alpha v2 package shapes differ. Avoid large abstractions until the first MCP endpoint is proven.
- **Permission mismatch.** Existing app roles (`admin`, `member`, `viewer`) are not enough for MCP; connector scopes and share capabilities must be explicit and deny by default.
- **Prompt injection and tool-output leakage.** Treat all model-originated arguments as untrusted. Never put secrets in `structuredContent`, `content`, `_meta`, tool descriptions, or deep links.
- **Deep-link session mismatch.** ChatGPT's connected user and the browser user may differ. The web app must re-authorize every batch load.

## Source References

- OpenAI MCP guide: https://developers.openai.com/api/docs/mcp
- OpenAI Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- OpenAI Apps SDK MCP server guide: https://developers.openai.com/apps-sdk/build/mcp-server
- OpenAI Apps SDK connect guide: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI MCP and Connectors API guide: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- MCP authorization spec 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP transport spec 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP Fastify middleware readme: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/middleware/fastify/README.md
