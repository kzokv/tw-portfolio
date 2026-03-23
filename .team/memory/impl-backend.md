# Backend Implementation Memory — KZO-107

## Spec deviations

1. **`store.transactions` does not exist** — The design doc's `seedDemoTransactions` sketch used `store.transactions`, but the actual `Store` interface has no `transactions` field. Trade events live at `store.accounting.facts.tradeEvents`. The `BookedTradeEvent` type also requires a `userId` field not shown in the sketch.

2. **`demoRateBuckets` isolation** — Module-level rate bucket Map in `registerRoutes.ts` persists across `buildApp` calls in the same test worker. Exported `_resetDemoRateBuckets()` test helper to clear it in `beforeEach`. This is a test environment gotcha — production has one server instance so it's fine.

3. **PostgresPersistence class boundary** — The class ends at line ~1896 with standalone helper functions after it. The design doc said "after readiness method" but `readiness()` is in the middle of the class, followed by `saveAccountingStore` and many more methods. Added `markDemoUser` and `getPool` at the actual end of the class (before standalone functions).

## Non-obvious decisions

- Used `BookedTradeEvent` type import in `demoData.ts` for type safety rather than `as any` cast from the design sketch.
- Demo rate limit uses its own `Map` (`demoRateBuckets`) separate from the global `mutationBuckets` in `app.ts`, per design doc recommendation. No changes to `app.ts` rate limiting.
