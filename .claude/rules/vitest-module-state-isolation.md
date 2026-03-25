# Vitest Module-Level State Isolation

Module-level stateful objects (e.g., Maps, Sets, timers) persist across `buildApp()` calls within the same Vitest test worker. Tests must explicitly reset this state in `beforeEach`.

**Example: demoRateBuckets**

```ts
import { _resetDemoRateBuckets } from "path/to/registerRoutes.js";

describe("demo auth rate limiter", () => {
  beforeEach(() => {
    _resetDemoRateBuckets(); // Reset module-level state
  });

  it("rate limits after N requests", async () => {
    // Test logic...
  });
});
```

**Why state leaks:**
When multiple tests in the same worker call `buildApp()`, they share module-level objects that were instantiated at import time. Without reset, rate limit state (or similar) persists across tests, causing flaky failures where later tests unexpectedly hit the limit.

**Pattern for future module state:**
Whenever a module defines persistent state (rate buckets, caches, pools, etc.), export a `_reset*` helper function and document its use in tests.

**Why:** Discovered in KZO-114 testing. Demo rate limiter state persisted between tests, causing unexpected 429 responses.

**How to apply:** Any test file that exercises a route with module-level state must import and call the `_reset*` helper in `beforeEach`. This is a template for any future rate-limited or stateful routes.
