---
name: feedback_qa_test_infra_check
description: QA must verify test infrastructure (mock servers, playwright configs) exists before writing infra-dependent tests
type: feedback
---

Before writing any test that depends on external infrastructure — mock servers, specific playwright configs, test database seeds, environment flags — QA must first verify that infrastructure is present and wired into the test config.

**Why:** In KZO-74, the N8 full-roundtrip test was written assuming a mock OAuth server was available in `specs-oauth/`. It was not included in `playwright.oauth.config.ts`. The test could never have passed and wasn't caught in the test plan review, wasting 2 investigation cycles to find the root cause.

**How to apply:**
- Add an "infrastructure checklist" step at the start of QA planning: "What servers/configs does this test need? Are they present and wired in?"
- For Playwright tests: check `playwright.oauth.config.ts` `webServer` array before writing tests that call OAuth endpoints
- For any test depending on a mock server: verify it's in the relevant playwright config's `webServer` list before writing the test
- If infrastructure is missing, create a task to add it before writing the dependent test, or note it as a known skip with a `// FIXME:` comment explaining the gap
