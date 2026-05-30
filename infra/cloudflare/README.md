# Cloudflare Edge Rules

This directory contains checked-in Cloudflare configuration fragments that must stay aligned with the operations runbook.

## ChatGPT MCP/OAuth Skip Rule

`chatgpt-mcp-skip-rule.json` is the desired WAF custom-rule fragment for the public Vakwen API hostname. Apply it as the first rule in the zone-level `http_request_firewall_custom` entrypoint ruleset after replacing `<PUBLIC_API_HOST>` with the deployed API hostname.

The rule uses the Cloudflare Ruleset Engine `skip` action to skip:

- remaining custom WAF rules in the current ruleset
- rate limiting rules via `http_ratelimit`
- managed WAF rules via `http_request_firewall_managed`
- Super Bot Fight Mode rules via `http_request_sbfm`
- Browser Integrity Check via product `bic`
- previous-version rate limit and managed WAF products via `rateLimit` and `waf`

Plain Bot Fight Mode is not skippable by WAF custom rules. Keep plain Bot Fight Mode off for zones where ChatGPT must call the API.

Validate the checked-in template or an exported Cloudflare ruleset before deploy:

```bash
npm run infra:cloudflare:validate
node infra/cloudflare/validate-chatgpt-mcp-skip-rule.mjs /path/to/exported-ruleset.json
```

When updating this rule, also update `docs/002-operations/runbook.md`.
