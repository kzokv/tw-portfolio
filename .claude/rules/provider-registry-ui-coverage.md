# Provider Registry UI Coverage

When a provider is added, a provider id becomes newly visible in admin UI, or a provider-specific admin action changes semantics, audit every provider-keyed UI dictionary and provider list in the same review pass.

## The rule

Trigger this audit for changes touching provider registry, provider-health routes, market-data provider ids, or admin Providers UI.

```bash
rg -n "rerunTooltip|PROVIDERS|provider-help|providerId ===|ProviderId" apps/web apps/api/test libs/test-api docs
```

For each provider id in the API provider list:

1. Confirm any provider-keyed UI copy exists for that id, especially tooltip/help text and dangerous-action guardrail text.
2. Confirm tests assert meaningful content for new provider-specific copy, not only that a trigger/button exists.
3. Confirm runbook and transition/todo docs describe the same defaults and provider ids as the implementation.
4. Confirm provider-health HTTP tests assert the concrete provider id set instead of only a stale count helper, and update E2E seed schemas such as `/__e2e/seed-provider-health-status` when new provider ids are expected in the admin registry.

## Why

KZO-197 review closure added the KR resolver repair scope after the original AU provider-health todo. The UI rendered `provider-help-trigger-yahoo-finance-kr` and `provider-help-trigger-twelve-data-kr`, but the provider-keyed tooltip dictionary only had pre-KR entries. Trigger-presence tests still passed while the KR popover content was empty. The fix added KR tooltip entries and a focused unit assertion that the KR popover mentions the safe `quote_first` default, `chart_probe_v1`, and the live cooldown.

MCP price-refresh validation later caught the same drift class on the API side: the admin provider registry had grown to 10 rows, but `provider-health-aaa.http.spec.ts` still used an "eight providers" helper and the E2E seed schema lacked JP provider ids. The fix asserted the exact provider ids and kept the seed enum aligned with the registry.

## How to apply

- Frontend implementer: when extending an admin provider list, add the copy entry and content test in the same patch as the visible provider row/action.
- Backend/API implementer: when adding provider ids to HTTP fixtures or DTOs, point the frontend reviewer at the new ids so provider-keyed UI maps can be audited.
- Code reviewer: do not accept "trigger renders for every provider" as sufficient coverage for provider help surfaces. At least one provider-specific dangerous or newly-added provider path should assert real text content.
