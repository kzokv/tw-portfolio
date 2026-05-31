# Debate: Q7 — 127.0.0.1 vs localhost Unification in E2E Test Infra

> Date: 2026-03-22
> Participants: Architect, Frontend Engineer, DevOps Engineer, QA Engineer
> Topic: Should KZO-106 unify E2E test infrastructure on `localhost` by fixing the mock OAuth server, or keep `127.0.0.1`?

## Options Under Consideration

### Option A — Fix the root cause
Make the mock OAuth server bind to `localhost` (or dual-stack) instead of `127.0.0.1`, then unify `flows.ts` on `localhost` so the entire test infra uses a single hostname. Remove the `E2E_BASE_URL` / `E2E_API_BASE_URL` env vars and derive all URLs from `TestEnv`.

### Option B — Keep 127.0.0.1, remove env vars only
Keep `127.0.0.1` as the canonical E2E host in `TestEnv` (or at least in `flows.ts`). Remove the `E2E_BASE_URL` / `E2E_API_BASE_URL` overrides but preserve the IPv4 literal to avoid IPv6 issues. Accept the split between `TestEnv.host` ("localhost") and E2E URL construction ("127.0.0.1").

## Technical Context

**Current state:**
- `TestEnv.host` = `"localhost"` (used for Playwright `baseURL`, cookie domains, server configs)
- `flows.ts` lines 7-8 hardcode `127.0.0.1` for `e2eBaseURL` / `e2eApiBaseURL`
- Mock OAuth server (`mock-oauth-server.mjs:67`) binds to `127.0.0.1` explicitly
- Playwright configs use `TestEnv.host` ("localhost") for `baseURL` and health check URLs

**DNS resolution on this macOS (Darwin 25.2.0):**
- `dns.lookup('localhost', { all: true })` returns `::1` (IPv6) first, then `127.0.0.1` (IPv4)
- `net.createServer().listen(port, 'localhost')` binds to `::1` only (IPv6)
- Node.js >= 20 enables `autoSelectFamily` (happy eyeballs) by default for outbound connections

**Cookie behavior:**
- Cookies set on `localhost` are NOT sent to `127.0.0.1` (different origins)
- `assignE2EUser()` in `flows.ts` sets cookies via `appUrl("/")` which resolves to `http://127.0.0.1:3333/`
- Playwright `baseURL` is `http://localhost:3333` — potential cookie mismatch

**Node.js requirement:** >= 24.13.0 (happy eyeballs enabled by default)

---

## Debate Rounds

### Round 1

**Architect:** I'm in favor of Option A — fixing the root cause. The current setup has a split-brain problem: `TestEnv.host` says "localhost" but `flows.ts` says "127.0.0.1". This is actively confusing for anyone reading the code. Worse, there's a latent cookie bug: `assignE2EUser()` sets cookies on `127.0.0.1`, but Playwright's `baseURL` navigates to `localhost`. In `dev_bypass` mode nobody checks cookies so it's invisible, but it means `flows.ts` and the Playwright config disagree about the origin. The fix is simple: change the mock OAuth server from `server.listen(port, "127.0.0.1")` to `server.listen(port)` — omitting the host binds dual-stack (`::`) on Node.js, accepting both IPv4 and IPv6 connections. One-line change, and then `flows.ts` can derive URLs from `TestEnv` like everything else.

**Frontend Engineer:** I agree with the direction, but I want to highlight why the cookie issue matters even if we're not seeing failures today. In `assignE2EUser()`, we call `page.context().addCookies()` with `url: appUrl("/")`, which is `http://127.0.0.1:3333/`. That cookie is scoped to the `127.0.0.1` origin. But the browser navigates to `http://localhost:3333` (Playwright's `baseURL`). If we ever need to read that cookie from the browser context during a test, it won't be there. This is a correctness landmine. I support Option A — unify on `localhost` and eliminate the mismatch.

**DevOps Engineer:** Hold on. The CRITICAL comment in `flows.ts` exists for a reason — someone hit this problem before and documented it. Let me be specific about the risk: on this macOS, `server.listen(port, 'localhost')` binds to `::1` only. If we change the mock server to `server.listen(port)`, it binds to `::` (dual-stack), which works. But "omit the host" is fragile — it's behavior that varies by OS and Node.js version. What happens on a Linux CI runner where `localhost` might resolve differently? What about Windows contributors? I'd rather see `server.listen(port, "0.0.0.0")` for explicit IPv4-all-interfaces binding, or better yet, keep `127.0.0.1` and fix the cookie mismatch by making `flows.ts` use `TestEnv.host` instead. The mock server doesn't need to change if happy eyeballs handles the client-side resolution.

**QA Engineer:** I run these tests daily. The current setup works — I've never seen an IPv6-related test failure. But I have seen confusion when new contributors try to understand why `flows.ts` uses `127.0.0.1` while everything else uses `localhost`. The CRITICAL comment helps, but it's a band-aid for architectural confusion. My concern with Option A is regression risk: if we change the mock server binding and something breaks, we're debugging network-level issues in E2E tests, which is one of the worst debugging experiences. I want to see this change verified on both macOS and Linux (CI) before we merge it.

### Round 2

**Architect:** DevOps raises a fair point about explicit binding. Let me refine the proposal: instead of omitting the host (which relies on Node.js defaulting to dual-stack), we bind to `"0.0.0.0"`. This is explicit, well-understood, and accepts connections from any IPv4 address including `127.0.0.1`. On Node.js >= 20 with happy eyeballs, a client connecting to `localhost` will try both `::1` and `127.0.0.1` — the `::1` attempt fails (server isn't listening on IPv6), but `127.0.0.1` succeeds immediately. The total connection time impact is negligible because happy eyeballs races both in parallel. This gives us: (1) explicit binding behavior, (2) all URLs unified on `localhost`, (3) happy eyeballs handles the resolution transparently.

**Frontend Engineer:** I want to push back on the "keep 127.0.0.1" direction. DevOps suggested making `flows.ts` use `TestEnv.host` while keeping the mock server on `127.0.0.1`. But look at `TestEnv.mockTokenUrl` — it's already `http://localhost:4445/token`. The API server receives this as `GOOGLE_TOKEN_URL` and makes HTTP requests to it. If `localhost` resolves to `::1` first and the mock server is on `127.0.0.1`, the API server's outbound request to the mock depends entirely on happy eyeballs working correctly. This is already the current behavior and it works, which proves happy eyeballs handles this fine. So the question isn't "will changing to localhost break things" — we're already relying on localhost-to-127.0.0.1 resolution for the most critical path (token exchange). The only inconsistency is `flows.ts` where we gratuitously hardcode `127.0.0.1` for the web/API URLs (which aren't even the mock server!).

**DevOps Engineer:** That's actually a compelling point. I didn't realize `TestEnv.mockTokenUrl` already uses `localhost` for the mock OAuth server connection. If the API's token exchange already works through `localhost → 127.0.0.1` via happy eyeballs, then `flows.ts` hardcoding `127.0.0.1` for the web and API servers (which listen on `localhost`) is inconsistent, not safer. Let me revise: I'm warming up to Option A with `"0.0.0.0"` binding, but I still want one thing — a smoke test that verifies the mock OAuth server is reachable via `localhost` before the E2E suite runs. Playwright's `webServer` config already does a health check via the `port` field, but that check might connect to `127.0.0.1` directly. Can we confirm Playwright's port check works with the `0.0.0.0` binding?

**QA Engineer:** Frontend Engineer made the killer point: `TestEnv.mockTokenUrl` already routes through `localhost` in production-path code (the API server's token exchange). If that works, the whole "IPv6 issue" premise of keeping `127.0.0.1` in `flows.ts` is undermined. The comment says "keep 127.0.0.1 to avoid IPv6 issues" but the most IPv6-sensitive path (mock OAuth token exchange) already uses `localhost` without problems. I'm now leaning Option A. Regarding regression risk: we should run the full E2E suite on the branch before merging. If happy eyeballs has been silently handling `localhost → 127.0.0.1` for `mockTokenUrl` this whole time, adding `flows.ts` to that same pattern is low-risk.

### Round 3

**Architect:** Good, we're converging. Let me address DevOps' question about Playwright's port check. When Playwright's `webServer` config specifies `port: mockOAuthPort`, Playwright connects to `localhost:${mockOAuthPort}` by default to check if the server is ready. With `"0.0.0.0"` binding, the mock server accepts connections on all IPv4 interfaces, so `127.0.0.1:4445` works. With happy eyeballs, Playwright's check to `localhost:4445` will race `::1:4445` (fails) and `127.0.0.1:4445` (succeeds). This is identical to how the API server already reaches `TestEnv.mockTokenUrl`. But I want to propose an even cleaner approach: bind to `"::"` (IPv6 any) instead of `"0.0.0.0"`. On dual-stack systems (which macOS is), `"::"` accepts both IPv4 and IPv6 connections. This eliminates the happy-eyeballs race entirely — whether the client connects via `::1` or `127.0.0.1`, the server accepts both.

**Frontend Engineer:** I like the dual-stack `"::"` approach in theory, but `"0.0.0.0"` is more widely understood and has fewer edge cases across OS configurations. Some older Linux kernels or Docker containers might have `net.ipv6.bindv6only=1`, which would make `"::"` reject IPv4 connections. For a test-only mock server, I'd rather use the simpler, more predictable binding. Let's go with `"0.0.0.0"` — it's explicit, it works on all platforms, and happy eyeballs on Node.js 24+ handles the client-side resolution. We're not trying to make the mock server reachable via IPv6; we're trying to make it reachable when someone connects to "localhost", which happy eyeballs already handles for IPv4.

**DevOps Engineer:** I agree — `"0.0.0.0"` is the right call. In CI (typically Linux containers), `localhost` usually resolves to `127.0.0.1` only, so the IPv6 question is moot there. On macOS developer machines, happy eyeballs handles the dual resolution. And `"0.0.0.0"` is a single well-understood semantic: "listen on all IPv4 interfaces." I withdraw my earlier objection. One implementation detail: we should also update the `process.stderr.write` log message in the mock server to say `localhost:${port}` instead of `127.0.0.1:${port}`, so the log matches the actual URL developers should use.

**QA Engineer:** I'm on board with Option A using `"0.0.0.0"`. Let me outline what I want verified before this ships: (1) The dev_bypass E2E suite passes — this exercises `flows.ts` URL construction. (2) The OAuth E2E suite passes — this exercises the mock token exchange path. (3) Both suites pass on macOS (developer) and Linux (CI). The actual code changes are small: one line in `mock-oauth-server.mjs`, a few lines in `flows.ts` to use `TestEnv.appBaseUrl` and `TestEnv.apiBaseUrl`, and removing the `E2E_BASE_URL` / `E2E_API_BASE_URL` env var fallbacks. This is low-risk.

### Round 4

**Architect:** Let me finalize the implementation plan. The changes are:

1. **`mock-oauth-server.mjs`**: Change `server.listen(port, "127.0.0.1", ...)` to `server.listen(port, "0.0.0.0", ...)`. Update the log line.
2. **`flows.ts`**: Replace `e2eBaseURL` and `e2eApiBaseURL` with `TestEnv.appBaseUrl` and `TestEnv.apiBaseUrl`. Remove the `E2E_BASE_URL` / `E2E_API_BASE_URL` env var fallbacks. Remove the CRITICAL comment (the issue it warns about is resolved).
3. **`libs/config/src/test.ts`**: No changes needed — `TestEnv.host` remains `"localhost"`, and `appBaseUrl` / `apiBaseUrl` already use it.

Total: ~10 lines changed across 2 files. The CRITICAL comment in `flows.ts` can be replaced with a brief note explaining the `0.0.0.0` binding choice.

**Frontend Engineer:** Agreed. I want to add one detail: the `E2E_BASE_URL` / `E2E_API_BASE_URL` env vars were escape hatches for when someone needed to override the test URLs. With `TestEnv.host` already supporting `process.env.HOST`, anyone who needs a different host can set `HOST=something` and all URLs derive from it. The env var escape hatches are redundant and should be removed. This eliminates two undocumented env vars and reduces the configuration surface.

**DevOps Engineer:** One last thing: should we also change `TestEnv.host` from `"localhost"` to `"127.0.0.1"` to avoid the IPv6 resolution entirely? No — I'll answer my own question. `localhost` is correct for cookie consistency. `__Host-` prefixed cookies require the `Secure` flag in production but are hostname-scoped in dev. Using `localhost` consistently means cookies set by the API server (on `localhost:4000`) are sent by the browser to the web server (on `localhost:3333`). Switching to `127.0.0.1` would work for IP-to-IP consistency but would break `__Host-` cookie semantics in some browsers. So: `localhost` stays as the canonical host, `0.0.0.0` as the mock server bind address, and happy eyeballs bridges the gap. I'm fully on board.

**QA Engineer:** Clean consensus. I'll flag one risk to monitor: if a future Node.js version changes `autoSelectFamily` default behavior, the happy eyeballs assumption could break. But that's speculative, and the explicit `"0.0.0.0"` binding makes us resilient regardless — the mock server accepts IPv4 connections regardless of how the client resolves `localhost`. I'm satisfied with Option A.

---

## Key Arguments Summary

| Argument | For Option A (fix root cause) | For Option B (keep 127.0.0.1) |
|---|---|---|
| **Cookie consistency** | Unifying on `localhost` eliminates the cookie domain mismatch between `flows.ts` (127.0.0.1) and Playwright baseURL (localhost) | Not addressed — the mismatch persists but is invisible in `dev_bypass` mode |
| **Code clarity** | Single hostname across all config — no CRITICAL comment needed, no split-brain | Preserves a "known working" setup but requires a permanent warning comment |
| **IPv6 safety** | `0.0.0.0` binding is IPv4-explicit; happy eyeballs handles client-side resolution | `127.0.0.1` is maximally explicit for IPv4, zero ambiguity |
| **Existing precedent** | `TestEnv.mockTokenUrl` already uses `localhost` for the most critical path (token exchange) — IPv6 resolution is already handled | The CRITICAL comment warns against this, but was written before happy eyeballs was default |
| **Regression risk** | Low — 2 files, ~10 lines changed, well-understood networking primitives | Near-zero — no change to working behavior |
| **Env var surface** | Removes 2 undocumented env vars (`E2E_BASE_URL`, `E2E_API_BASE_URL`) | Could still remove env vars while keeping 127.0.0.1 |
| **CI compatibility** | `0.0.0.0` works on Linux and macOS; `localhost` typically resolves to 127.0.0.1 on Linux CI | 127.0.0.1 works everywhere by definition |

## Consensus Decision

**Unanimous: Option A — Fix the root cause.**

Bind the mock OAuth server to `"0.0.0.0"` (explicit IPv4 all-interfaces) and unify `flows.ts` on `TestEnv`-derived URLs using `localhost`. The decisive argument was Frontend Engineer's observation that `TestEnv.mockTokenUrl` already routes the most critical path (API token exchange) through `localhost` → `127.0.0.1` via happy eyeballs without issues. The `127.0.0.1` hardcoding in `flows.ts` is inconsistent with existing behavior, not safer than it.

**Rationale:**
1. The cookie domain mismatch (`127.0.0.1` in flows.ts vs `localhost` in Playwright baseURL) is a latent correctness bug
2. Happy eyeballs (default in Node.js >= 20) already handles `localhost → 127.0.0.1` for the mock OAuth token exchange path
3. `"0.0.0.0"` binding is explicit, portable, and well-understood — no dual-stack ambiguity
4. Removing `E2E_BASE_URL` / `E2E_API_BASE_URL` reduces undocumented configuration surface

## Action Items

1. **`mock-oauth-server.mjs`**: Change `server.listen(port, "127.0.0.1", ...)` → `server.listen(port, "0.0.0.0", ...)`. Update stderr log message to show `localhost:${port}`.
2. **`flows.ts`**: Replace hardcoded `e2eBaseURL` / `e2eApiBaseURL` with `TestEnv.appBaseUrl` / `TestEnv.apiBaseUrl`. Remove `E2E_BASE_URL` / `E2E_API_BASE_URL` env var fallbacks. Replace the CRITICAL comment with a brief note about the `0.0.0.0` binding rationale.
3. **Verify**: Run both `playwright.config.ts` (dev_bypass) and `playwright.oauth.config.ts` (OAuth) suites on macOS and CI (Linux) before merging.
4. **No changes to `libs/config/src/test.ts`** — `TestEnv.host` remains `"localhost"`, which is correct for cookie semantics.
