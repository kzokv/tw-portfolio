# Playwright webServer Startup

Two root causes for Playwright webServer timeout failures. Both are silent — no error message, just a 60s timeout.

## IPv6/IPv4 Dual-Stack Binding

`localhost` resolves to `::1` (IPv6) first on macOS. Playwright's health-check poller hits ECONNREFUSED on IPv6 without falling back to IPv4. API/web servers must bind `"::"` (IPv6 dual-stack), not `"0.0.0.0"` (IPv4-only).

```ts
// ❌ Wrong — IPv4 only, Playwright can't reach it via localhost
server.listen({ host: "0.0.0.0", port });

// ✅ Correct — dual-stack, accepts both IPv6 and IPv4
server.listen({ host: "::", port });
```

**Do NOT hardcode `127.0.0.1` in playwright.config.ts URL fields:**
```ts
// ❌ WRONG — breaks cookie domain consistency
url: `http://127.0.0.1:${apiPort}/health/live`,

// ✅ CORRECT — always use TestEnv.host
url: `http://${host}:${apiPort}/health/live`,
```

The `host` value must be consistent across `baseURL`, `url`, OAuth redirects, and cookie domains. Hardcoding `127.0.0.1` while `baseURL` uses `localhost` causes cookie domain mismatches.

## .env.local Sourcing Override

Shell scripts in `package.json` that source `.env.local` unconditionally (`set -a && . ../../.env.local && set +a`) overwrite env vars already in `process.env` — including Playwright's `WEB_PORT=3333`. Next.js then starts on port 3000 but Playwright polls port 3333.

**Fix:** Remove `.env.local` sourcing from `dev` scripts. The web server only needs `NEXT_PUBLIC_*` vars (read by Next.js from `apps/web/.env.local`, not root `.env.local`).

**How to apply:** If E2E webServer startup ever times out, check: (1) API/web server binds `::` not `0.0.0.0`, (2) no script in the webServer command chain sources `.env.local` unconditionally, (3) all `url`/`baseURL` fields in playwright.config.ts use `TestEnv.host`.
