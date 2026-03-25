# Web App Environment Variable Pattern

Always use `WebEnv` from `@tw-portfolio/config/web` in web app code, never raw `process.env` with hardcoded fallback strings.

**Why it matters:**
This project uses typed env utilities: `Env` for the API, `WebEnv` for the web app. Hardcoding default strings (`"__Host-g_auth_session"`) in multiple files violates the single-source-of-truth principle and makes refactoring env configuration brittle.

**Wrong pattern:**
```ts
// ❌ In apps/web/proxy.ts or lib/auth.ts
const cookieName = process.env.SESSION_COOKIE_NAME ?? "__Host-g_auth_session";
```

**Correct pattern:**
```ts
// ✅ In apps/web/proxy.ts
import { WebEnv } from "@tw-portfolio/config/web";
const cookieName = WebEnv.SESSION_COOKIE_NAME;

// ✅ In apps/web/lib/auth.ts (server component)
import { WebEnv } from "@tw-portfolio/config/web";
const cookieName = WebEnv.SESSION_COOKIE_NAME;
```

**When adding new session-related env vars:**
1. Add to `webEnvSchema` in `libs/config/src/env-web.ts`
2. Rebuild `@tw-portfolio/config` package
3. Access via `WebEnv.YOUR_VAR` in web code
4. **Critical:** `env-web.ts` must remain free of Node.js modules (no `fs`, `path`) to stay Edge Runtime compatible

**How to apply:**
- Audit existing `apps/web/proxy.ts` and `apps/web/lib/auth.ts` for hardcoded defaults
- Replace with `WebEnv` import + usage
- When reviewing PRs that touch web env access, verify they use `WebEnv`
