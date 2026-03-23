# Demo Trigger Mechanism — Debate Meeting Note

**Date:** 2026-03-22
**Tickets:** KZO-107, KZO-108
**Participants:** Architect, Backend, Frontend, QA
**Facilitator:** Team Lead

---

## Decision

**Option 3: Next.js API route proxy at `/api/demo/start`.**

Consensus 3-1 after round 1. Architect conceded after cross-port testing evidence.

---

## Options Evaluated

| # | Option | Advocates | Verdict |
|---|--------|-----------|---------|
| 1 | `<form method="POST">` with 302 redirect | Architect | Rejected — cross-port testing gotchas |
| 2 | `fetch()` with `SameSite=None; Secure` | (none) | Rejected unanimously |
| 3 | Next.js API route proxy | Backend, Frontend, QA | **Selected** |

---

## The Problem

The demo button on the login page (web, port 3000) needs to `POST /auth/demo/start` on the API (port 4000), which creates a demo user, sets an HMAC session cookie, and gets the user to `/dashboard`.

`SameSite=Lax` cookies set via cross-origin `fetch()` responses are **silently dropped by the browser**. The existing OAuth flow works because `/auth/google/callback` is a top-level 302 redirect, not a fetch.

Additional constraint: `sessionStorage.setItem("isDemo", "true")` must fire before navigation for demo expiry UX.

---

## Round 1: Positions

### Architect — Option 1 (Form POST + 302 Redirect)

**Strongest points:**
1. Architectural symmetry with OAuth callback (top-level navigation, server sets cookie via redirect)
2. Zero cookie attribute changes — `SameSite=Lax` works on form POST
3. `onSubmit` fires synchronously before form submission — `sessionStorage` write is guaranteed by HTML spec
4. No proxy indirection — direct API-to-browser interaction
5. Progressive enhancement — core flow works without JS

**Against Option 3:**
- `Set-Cookie` forwarding through proxy is "non-trivial and fragile" — domain scoping concerns
- Adds indirection OAuth doesn't use (asymmetry)
- Proxy must handle redirect itself, losing `sessionStorage` timing guarantee

**Red lines:** No changes to `buildCookieAttrs`, no auth plumbing modifications, no proxy-based `Set-Cookie` forwarding.

### Backend — Option 3 (Proxy)

**Strongest points:**
1. Zero changes to cookie semantics — `SameSite=Lax` works same-origin
2. Fastify endpoint is origin-agnostic — returns JSON + `Set-Cookie`, doesn't care who called it
3. Structured error handling — JSON all the way, frontend can branch on status codes
4. CSRF is non-issue — same-origin proxy can't be targeted by external forms
5. Consistent with existing `/api/profile/route.ts` pattern

**Against Option 1:**
- Content-Type mismatch: form POST sends `application/x-www-form-urlencoded`, every other mutation endpoint expects JSON
- Error reporting broken: 429/500 redirects to... where? No error page exists for demo errors
- CSRF surface: any page can craft `<form action="...api:4000/auth/demo/start">`

**Implementation sketch:** API endpoint ~20 lines (returns JSON + Set-Cookie), Next.js proxy ~20 lines (forwards Set-Cookie header).

### Frontend — Option 3 (Proxy)

**Strongest points:**
1. `sessionStorage.setItem` guaranteed — sequential `await fetch()` then navigate, no form race
2. Rich inline error handling — same pattern as `SignInButton` (fetch → catch → setError → inline `<p role="alert">`)
3. Same-origin eliminates cross-origin cookie complexity entirely
4. Component model consistency — `DemoButton` is structurally parallel to `SignInButton` (client component, onClick, useState for errors)
5. No forms in a page that currently has zero forms

**Against Option 1:**
- `onSubmit` → `sessionStorage` → form navigation race: browsers may tear down page before storage write is flushed, especially Mobile Safari
- Error handling via redirect to `/login?error=...` is jarring — full page reload to show an error
- "Progressive enhancement" is irrelevant when `sessionStorage` (JS) is required for correctness

**Component sketch provided:** `DemoButton.tsx` with onClick → sessionStorage → fetch → navigate, plus inline error state.

### QA — Option 3 (Proxy)

**Strongest points (with hard evidence from documented bugs):**
1. Eliminates cross-port navigation chain — `feedback_e2e_cross_port_goto` documents that web:3000 → API:4000 → web:3000 causes `net::ERR_ABORTED`, requiring `waitUntil: "domcontentloaded"` + `.catch(() => {})` workarounds in 3 existing spec files
2. Zero cookie domain scoping issues — `feedback_e2e_cookie_domain_scope` documents `localhost` vs `127.0.0.1` mismatch; Option 3 keeps cookie on web origin
3. Deterministic test assertions — `page.waitForResponse("**/api/demo/start")` on same-origin, no cross-port ambiguity
4. Error state testing via `page.route()` on same-origin URLs — reliable and deterministic
5. `sessionStorage` assertions are straightforward — no cross-origin navigation that could clear it

**Against Option 1:**
- Three documented gotchas (`feedback_e2e_cross_port_goto`, `feedback_e2e_cookie_domain_scope`, `project_cookie_domain_session`) are all problems Option 1 inherits and Option 3 sidesteps
- `auth-session.spec.ts` line 23, `routing.spec.ts` line 96 already use `.catch(() => {})` workarounds for cross-port redirects
- `routing.spec.ts` line 112 has a `test.fixme` specifically because cross-port mock server lifecycle is unreliable

**Test plan provided:** 8 E2E scenarios, all same-origin, zero `.catch(() => {})` workarounds needed.

---

## Resolution: Why Option 3 Won

### Architect's Objections Addressed

**"Set-Cookie forwarding domain scoping is fragile"** — Actually backwards:
- `COOKIE_DOMAIN` set (Docker/prod): both API and web share `.kzokvdevs.dpdns.org`, forwarding works
- `COOKIE_DOMAIN` unset (local dev): browser receives cookie from `localhost:3000`, domain is `localhost` — **more correct** than cross-origin

**"Adds indirection OAuth doesn't use"** — True but irrelevant:
- OAuth callback is a GET initiated by Google's redirect (user has left the site)
- Demo start is a user-initiated POST on our own page
- Different interaction models warrant different mechanisms
- The indirection is 20 lines and follows an existing codebase pattern

**"No proxy-based Set-Cookie forwarding"** — The Architect's red line was based on the profile proxy NOT forwarding cookies. But:
- The profile proxy doesn't need to (it reads data, doesn't create sessions)
- Cookie forwarding is ~3 lines: `const setCookie = res.headers.get("set-cookie"); if (setCookie) response.headers.set("set-cookie", setCookie);`
- The domain concern is actually solved better same-origin than cross-origin

### Option 2 — Rejected Unanimously

No debater advocated. Key reasons:
- `SameSite=None; Secure` requires HTTPS everywhere including dev
- Fractures cookie policy — bifurcates `buildCookieAttrs` for one endpoint
- Browser divergence: Chrome allows `Secure` on HTTP localhost, Firefox does not
- Weakens CSRF protection for demo session cookies

### Option 1 — Rejected 3-1

The Architect's arguments were architecturally sound in isolation but contradicted by empirical evidence:
- QA provided 3 documented cross-port gotchas from this specific codebase
- Frontend showed the `sessionStorage` race is real on Mobile Safari
- Backend showed Content-Type mismatch creates the only non-JSON endpoint in the API

---

## Consensus: Implementation Shape

### API Side (Fastify)

```
POST /auth/demo/start
  Guard: DEMO_MODE_ENABLED !== "true" → 404
  Rate limit: 5 req/min per IP
  Create demo user: resolveOrCreateUser("demo", randomUUID(), ...)
  Mark demo: markDemoUser(userId, DEMO_SESSION_TTL_SECONDS)
  Seed data: seedDemoTransactions(persistence, userId)
  Sign cookie: signSessionCookie(userId, sessionSecret)
  Set-Cookie header: SameSite=Lax, Max-Age=DEMO_SESSION_TTL_SECONDS
  Return JSON: { userId, expiresAt, sessionType: "demo" }
```

Note: endpoint returns **JSON + Set-Cookie**, NOT a 302 redirect. The redirect is the frontend's job.

### Web Side (Next.js Proxy)

```
POST /api/demo/start (apps/web/app/api/demo/start/route.ts)
  Proxy to API: fetch(SERVER_API_BASE_URL/auth/demo/start, { method: "POST" })
  Forward Set-Cookie header from API response
  Return JSON body + status code to browser
```

### Frontend Side (Component)

```
DemoButton (client component)
  onClick:
    sessionStorage.setItem("isDemo", "true")
    const res = await fetch("/api/demo/start", { method: "POST" })
    if (!res.ok) → show inline error, remove sessionStorage flag
    if (res.ok) → window.location.href = "/dashboard"
```

### What This Preserves

- `buildCookieAttrs` unchanged
- `SameSite=Lax` for all cookies
- `resolveUserId` unchanged
- No auth plumbing modifications
- No new dependencies

---

## Arguments That Changed Minds

| Argument | From | Impact |
|----------|------|--------|
| 3 documented cross-port testing gotchas | QA | Killed Option 1 — empirical evidence from this codebase |
| Content-Type mismatch (form-urlencoded vs JSON) | Backend | Undermined "symmetry with OAuth" — it's the only non-JSON mutation |
| `sessionStorage` race on Mobile Safari | Frontend | Weakened Architect's "onSubmit is guaranteed" claim |
| Cookie domain is MORE correct same-origin | Team Lead | Reversed Architect's "Set-Cookie forwarding is fragile" objection |
| Same pattern as `/api/profile/route.ts` | Backend + QA | Established precedent neutralized "new proxy pattern" concern |

---

## Appendix: Vote Progression

| Role | Round 1 (Final) |
|------|-----------------|
| Architect | Option 1 → conceded to Option 3 |
| Backend | Option 3 |
| Frontend | Option 3 |
| QA | Option 3 |
