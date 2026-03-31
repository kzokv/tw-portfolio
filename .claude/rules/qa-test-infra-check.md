# QA Test Infrastructure Check

Before writing any test that depends on external infrastructure — mock servers, specific Playwright configs, test database seeds, environment flags — QA must first verify that infrastructure is present and wired into the test config.

**Infrastructure checklist (add to QA planning):**
> "What servers/configs does this test need? Are they present and wired in?"

**Playwright tests:**
- Check the relevant `playwright.*.config.ts` `webServer` array before writing tests that call OAuth endpoints or mock servers
- If a mock server is needed, verify it's listed in the `webServer` array for the correct config (`playwright.oauth.config.ts` for OAuth specs, etc.)

**If infrastructure is missing:**
- Create a task to add the missing infrastructure **before** writing the dependent test
- Or note the gap as a known skip with a `// FIXME:` comment explaining what's missing and why

**Why:** In KZO-74, the N8 full-roundtrip test was written assuming a mock OAuth server was wired into `specs-oauth/`. It was absent from `playwright.oauth.config.ts`. The test could never have passed, and this wasn't caught in the test plan review — wasting 2 investigation cycles to find the root cause.

**How to apply:** Every time QA starts writing tests that exercise external servers, OAuth flows, or environment-specific behavior. Apply before writing the first line of the test, not after.
