# Playwright OAuth Session Cookie Domain Scoping

OAuth session cookies are set on `localhost`, not `127.0.0.1`. These are different hostnames for cookie purposes in the browser.

**The problem:**
`apiUrl()` in test flows resolves to `http://127.0.0.1:{port}/...` (intentional for IPv4 mock server binding). But OAuth session cookies are set on `localhost` because `GOOGLE_REDIRECT_URI` points to `localhost:4000/auth/google/callback`. Clearing a cookie via `127.0.0.1` does NOT clear the same-named cookie on `localhost`.

```ts
// ❌ Wrong — clears cookie on 127.0.0.1, not localhost
await page.goto(apiUrl("/auth/logout"));

// ✅ Correct — clears cookie on localhost where it actually lives
await page.goto(
  `http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`,
  { waitUntil: "domcontentloaded" }
);
```

**Pattern for OAuth E2E logout:**
```ts
// Use TestEnv.host (defaults to "localhost")
const logoutUrl = `http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout`;
await page.goto(logoutUrl, { waitUntil: "domcontentloaded" });
```

**When to use which:**
- OAuth session cookie operations (login, logout) → use `TestEnv.host`
- Other API calls (non-session) → `apiUrl()` is fine
- `TestEnv.host` is the source of truth for OAuth cookie scope

**Why:** Discovered in KZO-114 when OAuth logout tests failed silently. The cookie wasn't being cleared because the hostname didn't match.

**How to apply:** When writing OAuth E2E tests that perform logout, use `TestEnv.host` instead of `apiUrl()` for the logout navigation.
