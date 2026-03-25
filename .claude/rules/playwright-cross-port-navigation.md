# Playwright Cross-Port Navigation

`page.goto()` that redirects across ports (e.g., API server on port 4000 redirects to web app on port 3333) must use `{ waitUntil: "domcontentloaded" }`, not the default `waitUntil: "load"`.

**Why it fails with "load":**
The default `waitUntil: "load"` destroys the original navigation context when the cross-port redirect fires, causing `net::ERR_ABORTED`.

```ts
// ❌ Wrong — will fail with ERR_ABORTED
await page.goto(apiUrl("/auth/logout"));

// ✅ Correct — allows redirect context switch
await page.goto(apiUrl("/auth/logout"), { waitUntil: "domcontentloaded" });
```

**Pattern:**
```ts
// Any page.goto() to an API endpoint that redirects cross-port:
await page.goto(apiUrl("/auth/logout"), { waitUntil: "domcontentloaded" });
```

**Why:** Discovered in KZO-114 logout E2E test. The pattern is already established for OAuth callback navigations in `auth-oauth.spec.ts`.

**How to apply:** Every `page.goto()` to `apiUrl(...)` or any API port URL in E2E specs must pass this option. Apply consistently across all E2E files.
