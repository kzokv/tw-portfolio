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
