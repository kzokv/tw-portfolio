import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RollingNumber } from "../../../components/ui/RollingNumber";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("RollingNumber", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const originalMatchMedia = window.matchMedia;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: originalMatchMedia });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: originalCancelAnimationFrame,
    });
    vi.useRealTimers();
  });

  it("does not animate on initial render and only animates when the quote-refresh key changes", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<RollingNumber value="NT$120" animateOnKey={0} />);
    });

    const initial = container.querySelector("[data-rolling-active='true']");
    expect(initial).toBeNull();

    act(() => {
      root?.render(<RollingNumber value="NT$125" animateOnKey={0} />);
    });
    expect(container.querySelector("[data-rolling-active='true']")).toBeNull();

    act(() => {
      root?.render(<RollingNumber value="NT$130" animateOnKey={1} />);
    });
    expect(container.querySelector("[data-rolling-active='true']")).not.toBeNull();
  });

  it("exposes one accessible value without duplicating visible text", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<RollingNumber value="NT$120" animateOnKey={0} />);
    });

    const value = container.querySelector("[data-rolling-active='false']") as HTMLElement | null;
    expect(value?.getAttribute("aria-label")).toBe("NT$120");
    expect(value?.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(container.textContent).toBe("NT$120");
  });

  it("keeps fallback text with spaces as one static run", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<RollingNumber value="Waiting for market value data" animateOnKey={0} />);
    });

    const hiddenText = container.querySelector("[aria-hidden='true']");
    expect(hiddenText?.children).toHaveLength(1);
    expect(container.textContent).toBe("Waiting for market value data");
  });

  it("starts changed digits at the initial transform before rolling in the next frame", () => {
    vi.useFakeTimers();
    let frameCallback: FrameRequestCallback | null = null;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 1;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        frameCallback = null;
      }),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<RollingNumber value="NT$120" animateOnKey={0} />);
    });
    act(() => {
      root?.render(<RollingNumber value="NT$125" animateOnKey={1} />);
    });

    const track = container.querySelector("[data-rolling-digit-track='true']") as HTMLElement;
    expect(track.style.transform).toBe("translateY(0)");
    expect(frameCallback).not.toBeNull();

    act(() => {
      frameCallback?.(performance.now());
    });

    expect(track.style.transform).toBe("translateY(-1em)");
    act(() => {
      vi.advanceTimersByTime(420);
    });

    expect(container.querySelector("[data-rolling-active='true']")).toBeNull();
    expect(container.textContent).toContain("NT$125");
  });

  it("falls back to static rendering when reduced motion is enabled", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<RollingNumber value="A$60,000" animateOnKey={0} />);
    });
    act(() => {
      root?.render(<RollingNumber value="A$61,000" animateOnKey={1} />);
    });

    expect(container.querySelector("[data-rolling-active='true']")).toBeNull();
    expect(container.textContent).toContain("A$61,000");
  });
});
