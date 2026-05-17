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

/**
 * Phase 4 (2026-05-17) — jsdom matchMedia stub.
 *
 * `useIsMobile` / `useIsSmallScreen` and other responsive hooks call
 * `window.matchMedia(...)` inside `useEffect`. jsdom does not implement it;
 * any component that mounts one of these hooks (e.g. `<DataTable>` with a
 * `mobileRow` slot) throws `TypeError: window.matchMedia is not a function`
 * during render in tests. The stub returns a no-op MediaQueryList — tests
 * never exercise breakpoint behavior in jsdom (Playwright covers that), so
 * always-false `matches` is sufficient.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      addListener: (): void => {},
      removeListener: (): void => {},
      dispatchEvent: (): boolean => false,
    }),
  });
}
