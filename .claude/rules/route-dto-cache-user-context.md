# Route DTO Cache: Partition by Session User and Portfolio Context

Any localStorage-backed route DTO cache for authenticated portfolio data must include both:

1. the signed-in session user id
2. the selected portfolio context owner id, or `self` when no shared-owner context is active

The selected owner context alone is not enough. A user can sign out, sign in as a different account, or switch demo/OAuth identities while the browser keeps localStorage. If the cache key only contains route + context owner, dashboard, portfolio, transaction, or report DTOs can be restored for the wrong authenticated user.

## Required Pattern

Use the shared route cache context helper instead of building context scope strings inline:

```ts
const { sessionUserId, locale } = useAppShellData();
const cacheKey = buildRouteDtoCacheKey(
  "dashboard-primary",
  getRouteDtoContextScope(sessionUserId),
  locale,
);
```

`getRouteDtoContextScope(sessionUserId)` formats:

```txt
session:{sessionUserId | "unknown"}:context:{contextOwnerId | "self"}
```

## Invalidation

Clear the route DTO cache prefix when any of these change:

- reporting-currency preference
- selected shared portfolio context
- signed-in session user
- sign-out
- API-driven 401 logout/session-expired flow

Cache version bumps are required when a key dimension changes.

## Metadata Validation for Omitted Dimensions

If a cache key intentionally omits a mutable dimension because invalidation is expected to handle it, validate the restored DTO metadata before showing cached values.

Example: dashboard primary cache keys do not include reporting currency, but restored dashboard DTOs must be rejected unless `summary.reportingCurrency` matches the current expected reporting currency from the server seed or current user preferences. If the expected dimension cannot be resolved, skip cache restore and fetch fresh data instead of briefly relabeling cached amounts.

## Why

The dashboard-reporting-ui follow-up review found that route DTO caches were correctly partitioned by selected portfolio owner but not by signed-in session user. That could restore cached dashboard/portfolio/report data across OAuth/demo user switches on the same browser. The fix added `sessionUserId` to `getRouteDtoContextScope()`, bumped the schema version, and cleared caches on sign-out/session changes.

## How to Apply

When adding a new primary DTO cache key for authenticated route data:

1. Get `sessionUserId` from `useAppShellData()`.
2. Include `getRouteDtoContextScope(sessionUserId)` in the cache key.
3. Include route-specific dimensions such as report tab/scope/currency/range, ticker/market/account, locale, and schema version.
4. Add a regression test that two session users with the same context owner produce different keys or context scopes.
5. When a route relies on invalidation instead of keying a mutable preference, add a metadata guard that rejects stale cached DTOs whose embedded effective preference does not match the current one.

## 2026-06-11 Addendum: Chart Range and Custom Date Dimensions

Chart-capable route DTO caches must include the full chart request identity, not only the route identity. For ticker detail/enrichment DTOs, key by ticker, market, account, selected chart range, and custom start/end dates. For reports, key by report tab, scope, range, and resolved reporting currency. Otherwise a cached `1Y` or native-currency DTO can be briefly restored while the UI is requesting `3Y`, custom dates, or another reporting currency, which relabels financial values and chart metadata dishonestly.

## 2026-06-12 Addendum: First-Render Query State for Chart Routes

Chart-capable App Router pages must pass server-parsed query parameters into the client component as initial state. Do not let the first hydration request depend only on `useSearchParams()` effects when the server already rendered a deep-linked chart range or custom date window. The initial request and visible controls must use the same route query that produced the server HTML; `useSearchParams()` can then synchronize later client-side navigation changes. Add component/page tests for custom deep links so the first client request includes the requested range and date bounds.

## 2026-06-15 Addendum: Fresh Cache Restores Still Need Request and Enrichment Guards

When a route hook restores a fresh DTO cache entry, bump or cancel the hook's request generation before applying the cached data. A previous in-flight request from another context, range, currency, or route slot must not be able to resolve later and overwrite the restored cache payload.

Fresh cache is only terminal for the route layer it proves complete. If a cached payload is a primary-only seed and the page depends on a secondary enrichment route for market values, valuation health, dividends, freshness, or quote details, render the cached primary data immediately but still start the enrichment refresh. Add hook coverage for both cases: fresh enriched cache skips automatic refetch, while fresh primary-only cache restores immediately and then refreshes enrichment.

## 2026-07-21 Addendum: Hide Context-Specific Metadata During Owner Transitions

Portfolio-specific metadata such as eligible tickers, account names, fee profiles, and filter options must be hidden or replaced immediately when the selected owner context changes. Do not keep rendering the prior context's metadata while the next primary request is pending, and do not leave it visible if that request fails.

Only an exact-current committed response may repopulate that metadata. Match the full request identity, not just the route or a partial scope, so a late response from an earlier owner, date range, account, or filter cannot overwrite the active context. Add a regression test that switches context, verifies prior-owner metadata disappears before the new response, and verifies a stale or failed response cannot restore it.
