---
name: e2e-cross-port-goto
description: page.goto() to an API endpoint that 302-redirects to a different port requires waitUntil domcontentloaded
type: feedback
---

Any `page.goto()` call that navigates to an API server endpoint (e.g. port 4000) which immediately 302-redirects to the web app (port 3333) MUST use `{ waitUntil: "domcontentloaded" }`.

**Why:** With the default `waitUntil: "load"`, Playwright destroys the original navigation context when the cross-port redirect fires, causing `net::ERR_ABORTED`. This happened on `page.goto(apiUrl("/auth/logout"))`.

**How to apply:**
- Every `page.goto()` to `apiUrl(...)` or any API port URL in E2E specs must pass `{ waitUntil: "domcontentloaded" }`
- The established pattern is already used for OAuth callback navigations in `auth-oauth.spec.ts`
- Apply consistently — the logout test was the only outlier that caused the failure
