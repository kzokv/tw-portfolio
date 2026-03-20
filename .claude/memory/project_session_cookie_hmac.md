---
name: session_cookie_hmac
description: Session cookies are HMAC-signed (userId.hmac format) using SESSION_SECRET — cookie stores internal UUID, not Google sub
type: project
---

Session cookie contains the internal UUID (`users.id`), signed as `${userId}.${hmac(userId, SESSION_SECRET)}`.

**Why:** KZO-77 changed identity resolution from Google sub-based to email-based. The cookie now carries the internal UUID so the server can look up the user by ID directly. Using UUID instead of Google sub isolates the session from the OAuth provider identity.

**How to apply:**
- `signSessionCookie(userId, sessionSecret)` and `verifySessionCookie(cookie, sessionSecret)` in `googleOAuth.ts` handle the signing
- `parseSessionCookie` in `registerRoutes.ts` verifies HMAC and returns the userId (UUID), not the Google sub
- Shared `hmacSign`/`hmacVerify` helpers are used by both session cookies and CSRF state tokens
- Test-only `/__e2e/oauth-session` endpoint mints signed cookies (gated to development/test); returns `{ status, sub, userId }` where `userId` is the UUID stored in the cookie
- Any code that reads or sets the session cookie must use the signed UUID format
- **SESSION_SECRET bypass:** `proxy.ts` silently skips HMAC verification when `SESSION_SECRET` is falsy — this is by design for dev mode. All pages remain protected because `requireSession()` enforces auth at the route level regardless. Do not treat the missing HMAC in proxy.ts as a bug to fix; it is intentional. In OAuth mode, always ensure SESSION_SECRET is set at config level.
