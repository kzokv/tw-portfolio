import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useEventStream } from "../../hooks/useEventStream";

vi.mock("../../lib/api", () => ({
  getApiBaseUrl: () => "http://test:4000",
}));

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials: boolean;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();

  private _listeners = new Map<string, Listener[]>();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    const arr = this._listeners.get(type) ?? [];
    arr.push(fn);
    this._listeners.set(type, arr);
  }

  removeEventListener() {
    /* no-op */
  }

  /** Fire a named event to all registered listeners. */
  _fire(type: string, data?: unknown) {
    for (const fn of this._listeners.get(type) ?? []) fn(data ?? new Event(type));
  }

  /** Invoke the onerror property handler. */
  _fireError(evt?: Event) {
    this.onerror?.(evt ?? new Event("error"));
  }
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).EventSource = MockEventSource;
});

// ---------------------------------------------------------------------------
// Wrapper component (no @testing-library/react dependency)
// ---------------------------------------------------------------------------

function Wrapper(props: { eventTypes: string[]; onEvent: (d: unknown) => void }) {
  useEventStream({ eventTypes: props.eventTypes, onEvent: props.onEvent, enabled: true });
  return null;
}

// ---------------------------------------------------------------------------
// Tests — Gap D: sliding-window retry reset
// ---------------------------------------------------------------------------

describe("useEventStream — sliding-window retry reset (Gap D)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let dateNow: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    MockEventSource.instances = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dateNow = vi.spyOn(Date, "now");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    dateNow.mockRestore();
  });

  function mount(onEvent = vi.fn()) {
    act(() => {
      root.render(createElement(Wrapper, { eventTypes: ["test"], onEvent }));
    });
    return MockEventSource.instances.at(-1)!;
  }

  it("resets retry count when error occurs after 60 s of stability", () => {
    const t0 = 1_000_000;
    dateNow.mockReturnValue(t0);

    const es = mount();
    act(() => es._fire("open")); // lastStableTimestamp = t0

    // 61 s later — error after stable period
    dateNow.mockReturnValue(t0 + 61_000);
    act(() => es._fireError()); // stableDuration >= 60 s → retryCount resets to 0

    // Connection stays open (retryCount 0 < MAX_RETRIES 5)
    expect(es.close).not.toHaveBeenCalled();
  });

  it("exhausts retries when errors occur within 60 s of open", () => {
    const t0 = 1_000_000;
    dateNow.mockReturnValue(t0);

    const es = mount();
    act(() => es._fire("open"));

    // 5 rapid errors at t0 + 5 s (well within the 60 s window)
    dateNow.mockReturnValue(t0 + 5_000);
    for (let i = 0; i < 5; i++) {
      act(() => es._fireError());
    }

    // retryCount reached MAX_RETRIES → EventSource closed
    expect(es.close).toHaveBeenCalled();
  });

  it("never exhausts retries across 10 reconnect cycles with 60 s stability each", () => {
    let now = 1_000_000;
    dateNow.mockImplementation(() => now);

    const es = mount();

    for (let cycle = 0; cycle < 10; cycle++) {
      act(() => es._fire("open")); // reset retryCount + record lastStableTimestamp
      now += 61_000;
      act(() => es._fireError()); // stableDuration >= 60 s → retryCount resets
    }

    // Every error was after a stable period — never accumulated enough retries
    expect(es.close).not.toHaveBeenCalled();
  });
});
