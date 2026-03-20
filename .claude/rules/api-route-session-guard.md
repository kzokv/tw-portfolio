# API Route Session Guard

In Next.js API route handlers (`app/api/**/route.ts`), always use `getSession()` with a manual 401 JSON return. Never use `requireSession()`.

```ts
// ✅ Correct — for route handlers
const session = await getSession(req);
if (!session) return NextResponse.json({ error: "auth_required" }, { status: 401 });

// ❌ Wrong — requireSession() returns 302/307 redirect, not a JSON 401
await requireSession(req);
```

The forwarded auth header follows the same pattern as `proxy.ts`:
```ts
headers: { "x-authenticated-user-id": session.userId }
```

**Why:** `requireSession()` issues a 302/307 redirect to `/login`. For JSON API endpoints (consumed by `fetch()`), a redirect is silent or causes cross-port navigation errors — the client receives an HTML login page instead of a JSON error. Established in KZO-78 with `apps/web/app/api/profile/route.ts`.

**How to apply:** Any time a new `apps/web/app/api/` route handler is created that needs auth, use `getSession()` + manual 401. Review existing route handlers for this pattern when adding auth.
