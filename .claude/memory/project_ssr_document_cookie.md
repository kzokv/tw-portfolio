---
name: ssr_document_cookie
description: document.cookie unavailable in Next.js server components — use next/headers cookies() for server-side auth header reading
type: project
---

`document.cookie` does not exist in Next.js server components or server-side code (API routes running in the Node.js runtime). Any utility that reads cookies for auth headers must use `next/headers` `cookies()` instead.

**Pattern:**

```ts
// ❌ Wrong — throws ReferenceError in server context
const cookie = document.cookie;

// ✅ Correct — works in server components and API route handlers
import { cookies } from "next/headers";
const cookieStore = await cookies();
const sessionCookie = cookieStore.get("session")?.value;
```

**When this surfaces in E2E:** Tests that run with custom auth headers (e.g., user isolation via cookie injection) can fail with `ReferenceError: document is not defined` if the auth header utility uses `document.cookie`. The fix is to make `getAuthHeaders()` async and use `next/headers` cookies().

**Why:** Surfaced in KZO-114 PR2 during E2E implementation when the senior-qa fixed auth header reading for test user isolation. The utility was initially written for client-side use and broke when called from server context.

**How to apply:** Any utility under `apps/web/lib/` that constructs auth headers must check: is this called from server components or API routes? If yes, use `next/headers`. If it needs to work in both contexts, accept an optional `cookieHeader` param from the caller.
