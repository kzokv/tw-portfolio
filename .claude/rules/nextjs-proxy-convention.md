# Next.js Proxy Convention

Next.js 16 uses `proxy.ts` as the active middleware convention in this repo. Do not add a sibling `middleware.ts`.

## Rule

- `apps/web/proxy.ts` is the production middleware entry point.
- Export `proxy(...)` from `apps/web/proxy.ts`; Next.js discovers it natively.
- Do not add `apps/web/middleware.ts` as a wrapper or compatibility shim.
- Preserve the `x-current-path` request header stamping in `proxy.ts`; `requireSession()` depends on it for `returnTo` redirects.

## Why

Next.js 16 resolves middleware handlers by checking `middlewareModule.proxy` before `middlewareModule.middleware`. The app already uses `apps/web/proxy.ts` with a named `proxy` export. Adding a sibling `middleware.ts` creates two middleware files and can crash the app at build/runtime instead of improving compatibility.

## How To Apply

When touching auth redirects, route protection, or Next.js middleware behavior:

1. Modify `apps/web/proxy.ts`.
2. Verify no `apps/web/middleware.ts` file is introduced.
3. Run the relevant auth/navigation tests, and include the OAuth E2E suite when session or redirect behavior changes.
