---
name: env_test_preexisting_failure
description: Pre-existing test failure in env.test.ts:123 — validateHostConsistency NODE_ENV guard mismatch
type: project
---

`libs/config/test/env.test.ts:123` has a pre-existing failure: `validateHostConsistency > throws when GOOGLE_REDIRECT_URI port does not match API_PORT`.

**Why:** `env.ts:104` guards the check with `Env.NODE_ENV === "development"`, but `vitest.config.ts` sets `NODE_ENV=test`. The guard was introduced in KZO-101/102 commit `386b298`. The test expects the validation to throw, but it silently passes because the guard skips it in test mode.

**How to apply:** When working on env validation, this test needs fixing — either change the guard to `!== "production"` (denylist) or update the test to set `NODE_ENV=development`. Track as a follow-up bug. Not a KZO-103 regression.
