---
name: E2E webServer startup gotchas
description: Two root causes for Playwright webServer timeout failures; fixed 2026-03-18
type: project
---

Two bugs caused `npm run test:e2e:bypass:mem` to time out on startup:

## Bug 1 — IPv6/IPv4 mismatch (server binds IPv4-only, localhost resolves IPv6 first)

`localhost` resolves to `::1` (IPv6) first on this machine. Playwright's Node.js health-check poller hit ECONNREFUSED on IPv6 without falling back to IPv4. The API server only bound `0.0.0.0` (IPv4-only).

**Fix:** Change the server's bind host from `"0.0.0.0"` to `"::"` (IPv6 dual-stack). On macOS/Linux with dual-stack enabled, `::` accepts both IPv6 (`::1`) and IPv4-mapped connections, so `localhost` (→ `::1`) works.

**WRONG fix — do NOT hardcode `127.0.0.1` in `playwright.config.ts` url fields:**
```ts
// ❌ WRONG — breaks cookie domain consistency
url: `http://127.0.0.1:${apiPort}/health/live`,
// ✅ CORRECT — always use TestEnv.host (from env file)
url: `http://${host}:${apiPort}/health/live`,
```
**Why:** The `host` value must be consistent across `baseURL`, `url`, OAuth redirects, and cookie domains. Hardcoding `127.0.0.1` in the health-check URL while `baseURL` uses `localhost` causes cookie domain mismatches that break auth e2e tests. Always use `TestEnv.host` (sourced from `HOST` env var or default `"localhost"`).

## Bug 2 — `.env.local` sourcing overrides Playwright's env vars (apps/web/package.json)

The `dev` script used `set -a && . ../../.env.local && set +a`, which overwrites env vars already in `process.env` (including Playwright's `WEB_PORT=3333` → `.env.local`'s `WEB_PORT=3000`). Next.js then started on port 3000, but Playwright polled port 3333.

**Fix:** Remove the `.env.local` sourcing from the `dev` script entirely.

```json
// Before
"dev": "[ -f ../../.env.local ] && set -a && . ../../.env.local && set +a; next dev -p ${WEB_PORT:-3000}"
// After
"dev": "next dev -p ${WEB_PORT:-3000}"
```

**Why safe:** The web server only needs `NEXT_PUBLIC_*` vars (read by Next.js from `apps/web/.env.local`, not the root `.env.local`). `WEB_PORT` defaults to 3000 if unset — same as what `.env.local` provides.

**How to apply:** If e2e webServer startup ever times out, check: (1) API/web server binds `::` not `0.0.0.0`, (2) no script in the webServer command chain sources `.env.local` unconditionally, (3) all `url` / `baseURL` fields in playwright.config.ts use `TestEnv.host`.
