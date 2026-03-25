---
name: project_session_cookie_architecture
description: Session cookie architecture — HMAC signing, __Host- prefix trap, COOKIE_DOMAIN coupling, cross-subdomain OAuth
type: project
---

## Cookie Naming and Domain

`SESSION_COOKIE_NAME` and `COOKIE_DOMAIN` are tightly coupled. Docker deploys API and web through separate Cloudflare Tunnel subdomains. The OAuth callback sets the session cookie on the API subdomain; `proxy.ts` checks for it on the web subdomain.

**The `__Host-` trap:** The `__Host-` cookie prefix (RFC 6265bis) prohibits the `Domain` attribute. If `SESSION_COOKIE_NAME=__Host-g_auth_session` is combined with `COOKIE_DOMAIN`, the browser silently drops the cookie. Users are permanently redirected to `/login` with no error.

**Correct docker config:** `SESSION_COOKIE_NAME=g_auth_session` (no `__Host-`) + `COOKIE_DOMAIN=.kzokvdevs.dpdns.org` (shared parent). Enforced by `Env.validateCookieConfig()` at startup.

## HMAC Signing

Session cookie contains the internal UUID (`users.id`), signed as `${userId}.${hmac(userId, SESSION_SECRET)}`.

- `signSessionCookie` / `verifySessionCookie` in `googleOAuth.ts`
- Cookie carries internal UUID (not Google sub) — isolates session from OAuth provider
- Shared `hmacSign`/`hmacVerify` helpers used for both session cookies and CSRF state tokens
- `proxy.ts` silently skips HMAC verification when `SESSION_SECRET` is falsy — intentional for dev mode
- Test-only `/__e2e/oauth-session` endpoint mints signed cookies (gated to development/test)

**How to apply:** When touching OAuth config, session cookies, or docker env setup. `COOKIE_DOMAIN` must be a parent of both `PUBLIC_DOMAIN_WEB` and `PUBLIC_DOMAIN_API`. Changing `SESSION_COOKIE_NAME` invalidates all active sessions.
