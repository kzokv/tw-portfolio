# Next.js Server-Side Cookie Access

`document.cookie` does not exist in Next.js server components or API route handlers. Any utility that reads cookies in a server context must use `next/headers` `cookies()`.

```ts
// ❌ Wrong — throws ReferenceError in server context
const cookie = document.cookie;

// ✅ Correct — works in server components and API route handlers
import { cookies } from "next/headers";
const cookieStore = await cookies();
const sessionCookie = cookieStore.get("session")?.value;
```

**Dual-context utilities:** If a utility under `apps/web/lib/` must work in both client and server contexts, accept an optional `cookieHeader` param from the caller rather than reading `document.cookie` directly.

**Why:** Surfaced in KZO-114 PR2 when the auth header utility was initially written for client-side use and broke when called from server context. Tests failed with `ReferenceError: document is not defined`.

**How to apply:** Any utility under `apps/web/lib/` that constructs auth headers — check whether it's called from server components or API routes. If yes, use `next/headers`.
