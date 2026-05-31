# Playwright Fast SSE Event Assertions

SSE recompute events fire <100ms after the triggering action. E2E assertions on mutation/recompute status must accept BOTH intermediate and final states in the same regex, because Playwright's polling assertion may skip the intermediate state entirely.

**The problem:**
```ts
// ❌ Wrong — intermediate state may be skipped by polling
await expect(page.getByTestId("mutation-status").first())
  .toContainText(/Recomputing/i);

// With SSE working correctly, "Recomputing..." appears for <100ms.
// Playwright's polling loop (default 500ms interval) can miss it entirely.
// Your test fails expecting a state that never got observed.
```

**Correct pattern:**
```ts
// ✅ Correct — accept both intermediate and final states
await expect(page.getByTestId("mutation-status").first())
  .toContainText(/Recomputing|recomputed successfully|Portfolio updated/i);

// Or use toHaveText with alternation:
const statusEl = page.getByTestId("mutation-status").first();
await expect(statusEl).toContainText(
  /Recomputing\.\.\.|\b(recomputed successfully|Portfolio updated)\b/i
);
```

**Why this happens:**
The SSE type forwarding fix (useEventStream.ts) made SSE events flow through `handleSSEEvent` for the first time. Previously, event.type was undefined, so discriminated union checks silently failed and the 10s safety net was the only path. With SSE working, `recompute_complete` now fires immediately, often before the next Playwright assertion poll.

**Assertion strategies:**
1. **Accept both states** — most robust, matches production behavior
2. **Wait for final state** — slower but less fragile
3. **Combine with explicit wait** — use `page.waitForLoadState("load")` before assertion

```ts
// Strategy 2: Wait for final state (slower, more reliable)
await expect(page.getByTestId("mutation-status").first())
  .toContainText(/recomputed successfully|Portfolio updated/i, { timeout: 5000 });

// Strategy 3: Stabilize before asserting
await page.waitForLoadState("load").catch(() => {});
await expect(page.getByTestId("mutation-status").first())
  .toContainText(/Recomputing|recomputed successfully|Portfolio updated/i);
```

**How to apply:**
- When writing E2E assertions on mutation/recompute status, use the regex pattern accepting both states
- Apply consistently across `specs/` and `specs-oauth/` E2E suites
- For any new SSE-driven features, apply the same multi-state assertion pattern

## SSE Event ID Assertions

Never assert exact SSE event ID values in E2E tests. Use range assertions instead.

```ts
// ❌ Wrong — seq is per-user and persists across connections
expect(result.eventId).toBe("1");

// ✅ Correct — accept any valid seq
expect(parseInt(result.eventId)).toBeGreaterThanOrEqual(1);
```

**Why:** `BufferedEventBus` maintains a per-user monotonic sequence counter that persists across SSE connections within the same server process. In E2E suites where multiple tests share a server, earlier tests consume seq values. The `useEventStream` hook (always-on, `enabled: true`) opens its own SSE connection on page load, consuming seq=1 before a test's EventSource connects.

**How to apply:** When writing E2E assertions on SSE event IDs in `specs/` or `specs-oauth/`, always use `toBeGreaterThanOrEqual(1)` or `toBeGreaterThan(0)`, never `toBe("1")`.
