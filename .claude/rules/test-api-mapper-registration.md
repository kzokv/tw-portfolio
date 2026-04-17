# Test-API Mapper Registration

When adding a new API endpoint class + assistant class to the AAA test framework (`libs/test-api/`), register the endpoint in `libs/test-api/src/config/mapper.ts`.

Missing registration compiles fine but fails at runtime: `"No assistant factory registered for endpoint: YourEndpoint"`. The error only appears when the test actually runs, not during typecheck.

**Checklist after creating a new endpoint+assistant pair:**
1. Create endpoint class in `libs/test-api/src/endpoints/`
2. Create assistant class in `libs/test-api/src/assistants/`
3. Register in `libs/test-api/src/config/mapper.ts`
4. Verify: `grep -r "YourEndpoint" libs/test-api/src/config/mapper.ts`

**Why:** KZO-132 iteration 1 failed suite 8 (API HTTP tests) because `NotificationsEndpoint` was not registered in the mapper. The endpoint and assistant compiled cleanly — the gap is only visible at runtime.

**How to apply:** Every time a new endpoint+assistant pair is added to `libs/test-api/`. Also verify during code review of PRs that add API AAA test infrastructure.
