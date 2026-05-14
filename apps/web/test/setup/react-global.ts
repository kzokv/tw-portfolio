/**
 * Make React available as a global for tests that use server-side rendering
 * (renderToStaticMarkup) with page components that use JSX.
 *
 * Vitest's esbuild SSR transform does not apply the automatic JSX runtime
 * to source files in all cases; components compiled in classic mode reference
 * React via the global scope. This setup ensures React is available.
 */
import * as React from "react";

Object.assign(globalThis, { React });

/**
 * ui-enhancement (2026-05-13) — minimal EventSource stub for jsdom.
 *
 * `useEventStream` constructs `new EventSource(...)` on mount. jsdom does
 * not implement EventSource and any component that subscribes
 * (`AccountsListSection`, `CashLedgerClient`, etc.) would throw
 * `ReferenceError: EventSource is not defined` during render in tests.
 *
 * The stub is a no-op — tests that care about SSE behavior already mock
 * `useEventStream` at the module level via `vi.mock(...)`. The stub only
 * needs to keep the constructor call from crashing.
 */
if (typeof (globalThis as { EventSource?: unknown }).EventSource === "undefined") {
  class StubEventSource {
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: unknown) => void) | null = null;
    onopen: ((event: unknown) => void) | null = null;
  }
  (globalThis as { EventSource?: unknown }).EventSource = StubEventSource;
}
