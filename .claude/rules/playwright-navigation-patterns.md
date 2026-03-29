# Playwright Navigation Patterns

Three navigation pitfalls discovered during E2E migration. All are silent failures — no error messages, just timeouts or wrong behavior.

---

## Cross-Port Navigation

`page.goto()` that redirects across ports (e.g., API server on port 4000 redirects to web app on port 3333) must use `{ waitUntil: "domcontentloaded" }`, not the default `waitUntil: "load"`.

The default `waitUntil: "load"` destroys the original navigation context when the cross-port redirect fires, causing `net::ERR_ABORTED`.

```ts
// ❌ Wrong — will fail with ERR_ABORTED
await page.goto(apiUrl("/auth/logout"));

// ✅ Correct — allows redirect context switch
await page.goto(apiUrl("/auth/logout"), { waitUntil: "domcontentloaded" });
```

**How to apply:** Every `page.goto()` to `apiUrl(...)` or any API port URL in E2E specs must pass this option. Discovered in KZO-114.

---

## SSE + networkidle Incompatibility

`page.waitForLoadState("networkidle")` can NEVER resolve when an SSE `EventSource` is open. SSE is a persistent HTTP connection that continuously sends keepalive traffic, permanently preventing the "no network requests for 500ms" threshold from being met.

**On any page with always-on SSE (e.g., AppShell's real-time updates), `networkidle` will always time out.**

```ts
// ✅ Correct — waits for DOM + scripts only, not network quiescence
await page.waitForLoadState("load");

// ✅ Soft-wait pattern for shared helpers (prevents budget exhaustion on slow resources)
await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});

// ✅ Most reliable — assert on a specific element
await expect(page.getByTestId("some-element")).toBeVisible();

// ❌ Wrong — hangs forever when SSE is open
await page.waitForLoadState("networkidle");
```

**How to apply:** Never use `waitForLoadState("networkidle")` in this app's E2E tests. Audit existing uses when adding new tests. For new shared helpers that stabilize page load, use the soft-`load` pattern. Discovered in KZO-114 PR2.

---

## webServer Startup Timeouts

Two root causes for Playwright webServer timeout failures. Both are silent — no error message, just a 60s timeout.

### IPv6/IPv4 Dual-Stack Binding

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

### .env.local Sourcing Override

Shell scripts in `package.json` that source `.env.local` unconditionally (`set -a && . ../../.env.local && set +a`) overwrite env vars already in `process.env` — including Playwright's `WEB_PORT=3333`. Next.js then starts on port 3000 but Playwright polls port 3333.

**Fix:** Remove `.env.local` sourcing from `dev` scripts. The web server only needs `NEXT_PUBLIC_*` vars (read by Next.js from `apps/web/.env.local`, not root `.env.local`).

**How to apply:** If E2E webServer startup ever times out, check: (1) API/web server binds `::` not `0.0.0.0`, (2) no script in the webServer command chain sources `.env.local` unconditionally, (3) all `url`/`baseURL` fields in playwright.config.ts use `TestEnv.host`.
