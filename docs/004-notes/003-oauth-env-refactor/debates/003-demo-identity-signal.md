# Demo Identity Signal Mechanism — Debate Meeting Note

**Date:** 2026-03-22
**Tickets:** KZO-107, KZO-108
**Participants:** Architect, Backend, Frontend, QA
**Facilitator:** Team Lead

---

## Decision

**Option C: Encode demo-ness in the cookie itself.**

Consensus 3-1 after round 1. QA conceded after mechanical test change analysis.

---

## Options Evaluated

| # | Option | Advocates | Verdict |
|---|--------|-----------|---------|
| A | Add `isDemo` to `Store` interface via existing `loadStore` query | (none) | Rejected — domain/identity conflation |
| B | Separate `isDemoUser(userId)` on Persistence | QA | Rejected — extra query for immutable data |
| C | Encode demo flag in cookie payload | Architect, Backend, Frontend | **Selected** |

---

## The Problem

The frontend needs an `X-Session-Type: demo` response header on every authenticated API response to render the demo banner, handle expiry UX, and distinguish demo from OAuth sessions. The question: where does the backend derive the `isDemo` flag from?

---

## Round 1: Positions

### Architect — Option C

**Core thesis:** `isDemo` is a session attribute, not a portfolio data attribute. The cookie is the session. The flag belongs in the cookie.

**Key arguments:**
1. `Store` interface (store.ts:232) is a portfolio domain object — every field describes portfolio state. `isDemo` answers "how was this session created?" which the portfolio engine never asks
2. Smallest blast radius: 3 files changed (googleOAuth.ts, registerRoutes.ts, session-cookie.test.ts) vs. 6+ for Option A, 4+ for Option B
3. Zero DB queries — `startsWith("demo:")` on an already-verified HMAC payload
4. Backward compatible — existing OAuth cookies verify unchanged, no forced logouts
5. HMAC signs full payload including `demo:` prefix — tamper-proof by construction

**Red lines:** `isDemo` must NOT be added to Store. No new Persistence methods for per-request demo checks.

### Backend — Option C

**Key arguments:**
1. `loadUserStore` return type doesn't change — stash `isDemo` on `req` via existing `onSend` hook
2. Route handlers (25 call sites) are completely untouched
3. Cookie format change is self-contained: `signSessionCookie` adds `isDemo` param, `verifySessionCookie` checks `startsWith("demo:")`
4. No MemoryPersistence changes needed
5. No Persistence interface changes needed

**Implementation insight — header via `onSend` hook:**
```ts
// In loadUserStore (registerRoutes.ts)
async function loadUserStore(app, req) {
  const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  const store = await app.persistence.loadStore(userId);
  syncAccountingPolicy(store);
  (req as any).__sessionType = isDemo ? "demo" : "authenticated";
  return { userId, store }; // return type UNCHANGED
}

// In existing onSend hook (app.ts)
if ((req as any).__sessionType) {
  reply.header("x-session-type", (req as any).__sessionType);
}
```

### Frontend — Option C

**Unique argument — SSR demo banner:**
With Option C, `getSession()` in Next.js Server Components can parse the cookie and return `{ userId, isDemo }`. The demo banner renders on the **first SSR render** before any client-side JS runs. Options A and B cannot do this — SSR has no API response headers to read.

**The new-tab problem:**
- `sessionStorage` is per-tab — new tab has no `isDemo` flag
- Cookie is cross-tab — new tab IS authenticated
- Only Option C ensures the backend knows it's a demo session in the new tab (cookie carries the signal)
- Options A/B also solve this via DB query, but Option C is zero-latency

**No first-request timing gap:**
Options A/B have a potential race: `POST /auth/demo/start` transaction hasn't committed when the first dashboard request hits `loadStore/isDemoUser`. Option C has no race — the flag is in the cookie that was just set.

### QA — Option B

**Core concern: test change footprint**

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Existing tests that break | 0 mechanical | **0** | **12+ assertions** |
| New test code | ~30 lines | ~55 lines | ~80 lines |
| Regression risk | Low-medium | **Low** | **High** (cookie format is security boundary) |

**Arguments:**
1. Zero existing tests break — purely additive
2. `isDemoUser` testable in isolation via Vitest (no cookies, no browser)
3. Cookie format is a security boundary — bugs silently break auth for all users
4. The 12 session-cookie unit tests are the guardrail against HMAC bugs; Option C requires rewriting them

---

## Resolution: Why QA Conceded

### The 12 test assertion changes are mechanical

Every failing assertion changes from:
```ts
expect(verifySessionCookie(signed, SECRET)).toBe("google-sub-123");
// to:
expect(verifySessionCookie(signed, SECRET)).toEqual({ userId: "google-sub-123", isDemo: false });
```

Plus 2-3 new test cases for the `demo:` prefix. This is a find-and-replace, not a rewrite.

### The security boundary concern is mitigated

The HMAC verification logic is structurally identical:
1. `lastIndexOf(".")` to split payload from HMAC — unchanged
2. `hmacVerify(payload, receivedHmac, secret)` — unchanged
3. NEW: `startsWith("demo:")` on the already-verified payload — 1 line

The crypto layer doesn't change. Only the interpretation of a verified payload changes. An attacker cannot:
- Strip `demo:` from a demo cookie — HMAC would be invalid
- Add `demo:` to an OAuth cookie — HMAC would be invalid
- The prefix is included in the signed payload

### TypeScript catches everything

`resolveUserId` return type changes from `string` to `{ userId: string, isDemo: boolean }`. Every call site (4 in registerRoutes.ts) must destructure. TypeScript compilation fails if any are missed. This is not a runtime risk.

### The SSR argument tipped the scale

QA acknowledged that Option C uniquely enables SSR demo banner detection — Server Components can parse the cookie without any API call. This is not achievable with Options A or B without adding a server-side `isDemoUser` call in the Next.js `getSession()` function (which would require the web app to query the API just to know if it's a demo session).

---

## Consensus: Implementation Shape

### Cookie Format

```
# OAuth session (unchanged)
{userId}.{hmac(userId, secret)}

# Demo session (new)
demo:{userId}.{hmac("demo:" + userId, secret)}
```

- HMAC signs the full payload including `demo:` prefix
- `verifySessionCookie` splits on `lastIndexOf(".")`, verifies HMAC, then checks `startsWith("demo:")`
- Backward compatible — existing OAuth cookies verify unchanged

### Code Changes

| File | Change |
|------|--------|
| `apps/api/src/auth/googleOAuth.ts` | `signSessionCookie` adds `isDemo` param; `verifySessionCookie` returns `{ userId, isDemo }` |
| `apps/api/src/routes/registerRoutes.ts` | `resolveUserId` returns `{ userId, isDemo }`; `loadUserStore` stashes on `req.__sessionType` |
| `apps/api/src/app.ts` | `onSend` hook reads `req.__sessionType`, sets `X-Session-Type` header |
| `apps/web/lib/auth.ts` | `getSession()` parses `demo:` prefix, returns `{ userId, isDemo }` |
| `apps/api/test/unit/session-cookie.test.ts` | Update 12 assertions + add 3 demo prefix tests |

### What Doesn't Change

- `Store` interface — untouched
- `Persistence` interface — no new methods
- `MemoryPersistence` — untouched
- `loadUserStore` return type — still `{ userId, store }`
- 25 route handlers — zero changes
- `buildCookieAttrs` — untouched
- Cookie name, SameSite, HttpOnly, Secure, Path — all unchanged

---

## Arguments That Changed Minds

| Argument | From | Impact |
|----------|------|--------|
| SSR demo banner via `getSession()` | Frontend | Unique capability only Option C provides — tipped QA |
| `loadUserStore` return type unchanged via `onSend` hook | Backend | Eliminated the "25 route handlers need updating" concern |
| HMAC verification is structurally identical | Architect | Defused QA's "security boundary" concern |
| `startsWith("demo:")` is 1 line on a verified payload | Backend | The "new code" in the crypto layer is trivially small |
| No first-request timing gap | Frontend | Options A/B have DB commit race; Option C doesn't |

---

## Appendix: Vote Progression

| Role | Round 1 (Final) |
|------|-----------------|
| Architect | Option C |
| Backend | Option C |
| Frontend | Option C |
| QA | Option B → conceded to Option C |

**QA conditions for concession:**
- Session-cookie unit tests updated in the same PR (not deferred)
- New test cases for `demo:` prefix round-trip verification added
- The `verifySessionCookie` return type change is covered by compile-time TypeScript checks
