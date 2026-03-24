# Playwright SSE + networkidle Incompatibility

`page.waitForLoadState("networkidle")` can NEVER resolve when an SSE `EventSource` is open. SSE is a persistent HTTP connection that continuously sends keepalive traffic, permanently preventing the "no network requests for 500ms" threshold from being met.

**On any page with always-on SSE (e.g., AppShell's real-time updates), `networkidle` will always time out.**

**Fix:** Use `waitForLoadState("load")` or element-based assertions instead:

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

**Why:** Burned 8 E2E tests in KZO-114 PR2. The always-on SSE connection from `useEventStream` (opened by AppShell on every page) meant every `networkidle` wait hit the full Playwright timeout.

**How to apply:** Never use `waitForLoadState("networkidle")` in this app's E2E tests. Audit existing uses when adding new tests. For new shared helpers that stabilize page load, use the soft-`load` pattern.
