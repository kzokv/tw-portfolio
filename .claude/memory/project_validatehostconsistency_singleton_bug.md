---
name: validateHostConsistency-singleton-bug
description: validateHostConsistency in env.ts uses Env.NODE_ENV singleton (not injectable envInput), causing a pre-existing test failure that was intentionally left unfixed
type: project
---

`libs/config/src/env.ts` line ~104: `validateHostConsistency` checks `Env.NODE_ENV === "development"` using the singleton, not the injectable `envInput.NODE_ENV` parameter. In vitest (NODE_ENV=test), this check is always false, so the function never throws. The test `"throws when GOOGLE_REDIRECT_URI port does not match API_PORT"` (env.test.ts:116) always fails as a result.

**Why:** This is a pre-existing failure that predates KZO-101/102. During KZO-101/102, the Architect explicitly instructed the Fixer not to fix it because the root cause is a production code design issue (singleton vs injectable), not a test setup problem — and the fix would require modifying `validateHostConsistency`'s signature.

**How to apply:** When this test appears as a failure, treat it as known-pre-existing and do not attempt to fix it by changing vitest config or auth mode. Any real fix requires widening the `Pick<EnvConfig, ...>` type at line ~65 to include `NODE_ENV` and changing line ~104 to use `envInput.NODE_ENV`.
