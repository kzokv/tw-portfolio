# ChatGPT MCP Connector Edge Diagnosis

When ChatGPT connector approval succeeds in Vakwen but ChatGPT immediately reports a connector error and the API logs show no `POST /oauth/token` or no follow-up `POST /mcp`, treat the edge/proxy path as suspect before changing OAuth token parsing.

**Checklist:**

1. Confirm the API logs for the exact approval window. A healthy flow includes `mcp_oauth_approval_redirect_issued`, then `POST /oauth/token`, `mcp_oauth_token_issued`, then `POST /mcp`.
2. If requests stop after approval, inspect Cloudflare Security Events and bot settings for the public API hostname.
3. Keep a first-match skip rule for ChatGPT MCP/OAuth paths:
   - `/mcp`
   - `/mcp/*`
   - `/oauth/*`
   - `/.well-known/oauth-*`
   - `/.well-known/openid-configuration`
4. The skip rule must skip custom WAF rules, rate limiting, managed rules, Super Bot Fight Mode rules, and Browser Integrity Check for those paths.
5. Plain Bot Fight Mode is not bypassed by Ruleset Engine skip rules. Disable plain Bot Fight Mode for the zone when ChatGPT must call the API.
6. Do not broaden OAuth token acceptance just because ChatGPT does not call `/oauth/token`. No request means the failure happened before token exchange.

**App-side compatibility floor:**

- MCP protected-resource metadata must be available at the path-scoped URL used in `WWW-Authenticate`.
- OAuth authorization metadata must include the OIDC aliases ChatGPT probes.
- Unauthenticated `initialize`, `tools/list`, and app-widget `resources/read` must work so ChatGPT can discover the app.
- Tool calls without a valid/sufficient token should return an MCP tool result with `mcp/www_authenticate`, not only a transport-level HTTP error.

**Proof of fix:** Reproduce in ChatGPT and require both UI success and API evidence: `POST /oauth/token` plus at least one `POST /mcp` after consent.

This rule came from the Vakwen Dev ChatGPT connector incident where repeated OAuth-code/token changes did not help because Cloudflare plain Bot Fight Mode blocked ChatGPT before token exchange.
