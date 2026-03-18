---
name: SESSION_COOKIE_NAME and COOKIE_DOMAIN — cross-subdomain OAuth session
description: Why SESSION_COOKIE_NAME and COOKIE_DOMAIN are coupled in docker deployments, and how misconfiguring them silently breaks OAuth login
type: project
---

`SESSION_COOKIE_NAME` and `COOKIE_DOMAIN` are a tightly coupled pair. Getting either wrong silently breaks the entire OAuth login flow.

**Why they exist:**
Docker deploys the API (`twp-dev-api.kzokvdevs.dpdns.org`) and web (`twp-dev-web.kzokvdevs.dpdns.org`) through separate Cloudflare Tunnel subdomains. The OAuth callback sets the session cookie on the API subdomain response; the Next.js 16 `proxy.ts` route guard checks for it on every request to the web subdomain.

**The trap — `__Host-` prefix:**
The `__Host-` cookie prefix (RFC 6265bis) prohibits the `Domain` attribute and makes cookies host-bound to a single origin. If `SESSION_COOKIE_NAME=__Host-g_auth_session` is combined with `COOKIE_DOMAIN`, the browser silently drops the cookie entirely (treats it as malformed). The session cookie ends up host-bound to the API subdomain, invisible to the web proxy, and users are permanently redirected to `/login` after signing in — with no error anywhere.

**The correct config for docker deployments:**
- `SESSION_COOKIE_NAME=g_auth_session` — no `__Host-` prefix
- `COOKIE_DOMAIN=.kzokvdevs.dpdns.org` — shared parent domain

The API sets `g_auth_session; Domain=.kzokvdevs.dpdns.org; Path=/; HttpOnly; SameSite=Lax; Secure`, making the cookie visible to both subdomains. The proxy finds it and allows access.

**Where this is enforced:**
- `dockerBaseExtension` in `env-docker.ts` overrides `SESSION_COOKIE_NAME` default to `g_auth_session`
- `dockerDevSchema` adds `COOKIE_DOMAIN` default `.kzokvdevs.dpdns.org`
- `Env.validateCookieConfig()` hard-rejects the `__Host-` + `COOKIE_DOMAIN` combination at startup
- Both `infra/docker/.env.dev.example` and `.env.prod.example` document the pair with explanation

**How to apply:** When touching OAuth config, session cookies, or docker env setup — verify these two are consistent. `COOKIE_DOMAIN` must be a parent of both `PUBLIC_DOMAIN_WEB` and `PUBLIC_DOMAIN_API`. Changing `SESSION_COOKIE_NAME` invalidates all active sessions.
