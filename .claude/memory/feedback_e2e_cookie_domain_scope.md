---
name: e2e-cookie-domain-scope
description: OAuth session cookies are scoped to localhost not 127.0.0.1 — logout must use localhost to clear the right cookie
type: feedback
---

`apiUrl()` in `flows.ts` resolves to `http://127.0.0.1:{port}/...` (intentional, for IPv4 mock server binding). But OAuth session cookies are set on `localhost` (because `GOOGLE_REDIRECT_URI` points to `localhost:4000/auth/google/callback`). These are different cookie scopes in the browser.

**Why:** `localhost` and `127.0.0.1` are different hostnames for cookie purposes. Clearing a cookie via `127.0.0.1` does NOT clear the same-named cookie on `localhost`.

**How to apply:**
- For the OAuth E2E logout navigation, use `http://${TestEnv.host}:${TestEnv.ports.api}/auth/logout` (resolves to `localhost`) NOT `apiUrl("/auth/logout")` (resolves to `127.0.0.1`)
- `TestEnv.host` defaults to `"localhost"` and is the correct hostname for OAuth session cookie operations
- `apiUrl()` is still correct for non-session-cookie API calls (start, callback, refresh)
