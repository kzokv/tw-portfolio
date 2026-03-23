---
name: Demo rate bucket test isolation
description: Module-level demoRateBuckets Map in registerRoutes.ts persists across buildApp() calls in same test worker — needs _resetDemoRateBuckets() in beforeEach
type: feedback
---

Module-level `demoRateBuckets` Map in `registerRoutes.ts` persists across `buildApp()` calls within the same Vitest test worker. Tests that exercise the demo rate limiter must call `_resetDemoRateBuckets()` in `beforeEach` to isolate state.

**Why:** Without reset, rate limit state leaks between tests, causing flaky failures where later tests hit the rate limit unexpectedly.

**How to apply:** Any test file that calls `POST /auth/demo/start` multiple times must import and call `_resetDemoRateBuckets()` in `beforeEach`. This is a template for any future module-level rate limit Maps.
