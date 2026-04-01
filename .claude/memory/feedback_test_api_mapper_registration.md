---
name: Test-API mapper registration checklist
description: New AAA endpoint+assistant classes must be registered in libs/test-api/src/config/mapper.ts or tests fail at runtime
type: feedback
---

When adding a new API endpoint class + assistant class to the AAA test framework (`libs/test-api/`), register the endpoint in `libs/test-api/src/config/mapper.ts`.

Missing registration compiles fine but fails at runtime: `"No assistant factory registered for endpoint: NotificationsEndpoint"`. The error only appears when the test actually runs, not during typecheck.

**Why:** KZO-132 iteration 1 failed suite 7 (API HTTP tests) because `NotificationsEndpoint` was not registered in the mapper. The endpoint and assistant compiled cleanly — the gap is only visible at runtime.

**How to apply:** After creating any new endpoint class in `libs/test-api/src/endpoints/` and its corresponding assistant in `libs/test-api/src/assistants/`, immediately add the registration entry in `mapper.ts`. Verify with a grep: `grep -r "YourEndpoint" libs/test-api/src/config/mapper.ts`.
