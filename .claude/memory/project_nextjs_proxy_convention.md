---
name: project_nextjs_proxy_convention
description: In Next.js 16 (used at v16.1.6), proxy.ts replaces the deprecated middleware.ts convention and is auto-discovered at build time
type: project
---

## Convention

Next.js 16 (v16.1.6) resolves the middleware handler via named export priority:

```js
// next/dist/server/next-server.js:1233
handler: middlewareModule.proxy || middlewareModule.middleware || middlewareModule
```

`proxy` is checked first. `apps/web/proxy.ts` exports `export function proxy(...)` — it matches.

`PROXY_FILENAME = 'proxy'` is defined in `next/dist/lib/constants.js:274`.

- **File location:** `apps/web/proxy.ts`
- **Auto-discovery:** Next.js resolves `proxy.ts` natively — no `middleware.ts` wrapper needed
- **Do NOT add middleware.ts:** Adding it alongside `proxy.ts` crashes the app (both files define middleware handlers)
- **`x-current-path` header:** Set by `proxy.ts` on authorized requests; used by `requireSession()` for returnTo redirect

## Project status

`apps/web/proxy.ts` is the active Next.js 16 middleware. Treat it as production middleware, not dead code.
