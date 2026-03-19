---
name: session_cookie_hmac
description: Session cookies are HMAC-signed (sub.hmac format) using SESSION_SECRET — not plain sub values
type: project
---

Session cookie changed from plain `claims.sub` to `${sub}.${hmac(sub, SESSION_SECRET)}`.

**Why:** The previous plain-sub cookie was forgeable by anyone who knew a user's Google sub (which is not secret). HMAC signing prevents cookie forgery.

**How to apply:**
- `signSessionCookie` and `verifySessionCookie` in `googleOAuth.ts` handle the signing
- `parseSessionCookie` in `registerRoutes.ts` verifies HMAC before trusting the sub
- Shared `hmacSign`/`hmacVerify` helpers are used by both session cookies and CSRF state tokens
- Test-only `/__e2e/oauth-session` endpoint mints signed cookies (gated to development/test)
- Any code that reads or sets the session cookie must use the signed format
