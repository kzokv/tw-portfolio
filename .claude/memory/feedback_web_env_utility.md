---
name: web-env-utility
description: Use @tw-portfolio/config/web WebEnv for session cookie name — never raw process.env with hardcoded fallbacks
type: feedback
---

Always use `WebEnv.SESSION_COOKIE_NAME` from `@tw-portfolio/config/web` in web app code (`proxy.ts`, `lib/auth.ts`), not raw `process.env.SESSION_COOKIE_NAME ?? "__Host-g_auth_session"`.

**Why:** The project has a Zod-validated env utility pattern. The API uses `Env` from `@tw-portfolio/config`. The web app has `WebEnv` from `@tw-portfolio/config/web`. Duplicating the default string `"__Host-g_auth_session"` in multiple files breaks the single-source-of-truth principle and is the "env utility mistake" pattern to avoid.

**How to apply:**
- In `apps/web/proxy.ts` (Edge Runtime): `import { WebEnv } from "@tw-portfolio/config/web"; WebEnv.SESSION_COOKIE_NAME`
- In `apps/web/lib/auth.ts` (Server Components): same import
- If adding a new session-related env var to the web app, add it to `webEnvSchema` in `libs/config/src/env-web.ts` and rebuild `@tw-portfolio/config`
- `env-web.ts` must stay free of Node.js modules (no `fs`, `path`) to remain Edge-compatible
