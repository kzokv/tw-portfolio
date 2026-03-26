# Session Cookie `__Host-` Prefix Trap

`SESSION_COOKIE_NAME` and `COOKIE_DOMAIN` are tightly coupled. The `__Host-` cookie prefix (RFC 6265bis) prohibits the `Domain` attribute. Combining `SESSION_COOKIE_NAME=__Host-g_auth_session` with any `COOKIE_DOMAIN` value causes browsers to **silently drop the cookie** — users are permanently redirected to `/login` with no error.

**Correct docker config:**
- `SESSION_COOKIE_NAME=g_auth_session` (no `__Host-` prefix)
- `COOKIE_DOMAIN=.kzokvdevs.dpdns.org` (shared parent of both API and web subdomains)

Enforced at startup by `Env.validateCookieConfig()`.

**HMAC signing:**
Session cookie contains the internal UUID (`users.id`) signed as `${userId}.${hmac(userId, SESSION_SECRET)}`.
- Sign/verify: `signSessionCookie` / `verifySessionCookie` in `googleOAuth.ts`
- Cookie carries internal UUID (not Google sub) — isolates session from OAuth provider
- `proxy.ts` silently skips HMAC verification when `SESSION_SECRET` is falsy (dev mode)
- Test-only `/__e2e/oauth-session` endpoint mints signed cookies (gated to development/test)

**How to apply:** When touching OAuth config, session cookies, or docker env setup. `COOKIE_DOMAIN` must be a parent of both `PUBLIC_DOMAIN_WEB` and `PUBLIC_DOMAIN_API`. Changing `SESSION_COOKIE_NAME` invalidates all active sessions.
