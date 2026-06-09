# Route Enrichment vs Mutation Refresh

When splitting a heavy route into primary and enrichment reads, keep mutation refreshes on the authoritative read path when the mutation can change primary accounting or position fields.

## Rule

- Initial mount and return-navigation hydration may use lightweight enrichment endpoints when primary route data is already seeded.
- User-triggered mutations that can change holdings, transactions, lots, average cost, quantity, market value, realized P&L, dividends, account scope, or other primary summary fields must refresh through the full route-owned read model or an equivalent mutation-aware primary endpoint.
- Do not reuse a chart/fundamentals-only enrichment endpoint as the post-mutation refresh unless it explicitly returns all affected primary fields.
- Cache writes after mutations must store the authoritative post-mutation DTO, not a pre-mutation primary seed merged with enrichment-only data.

## Why

The dashboard-reporting-ui PR split ticker details so normal ticker hydration fetched `/tickers/{ticker}/enrichment` after the server had already seeded primary details. That fixed duplicate full-detail work on mount. CI then caught a regression in `transaction-mutations-aaa.spec.ts`: after deleting a buy transaction, the ticker page kept showing quantity `300` instead of `200` because the mutation refresh still reused enrichment-only hydration. The fix kept mount hydration on `/enrichment` but added a full `/details` refresh after transaction mutations.

## Review Checklist

Before submitting a route split or cache-first performance change:

1. Identify every mutation path that can affect the route's primary numbers.
2. Verify those mutation paths refresh through a full/authoritative DTO, not only secondary enrichment.
3. Add focused service or hook coverage proving the endpoint split: normal hydration uses enrichment, mutation refresh uses authoritative details.
4. Run the narrow E2E or integration test that exercises post-mutation primary stats when one exists.
