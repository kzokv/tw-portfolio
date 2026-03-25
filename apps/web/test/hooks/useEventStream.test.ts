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

// ---------------------------------------------------------------------------
// QA wrapper (supports onReconnect and deprecated eventType prop)
// ---------------------------------------------------------------------------

function QAWrapper(props: {
  eventType?: string;
  eventTypes?: string[];
  onEvent: (d: unknown) => void;
  onReconnect?: (gap: { lastReceivedId: number; currentId: number }) => void;
}) {
  useEventStream({
    eventType: props.eventType,
    eventTypes: props.eventTypes,
    onEvent: props.onEvent,
    onReconnect: props.onReconnect,
    enabled: true,
  });
  return null;
}

// ---------------------------------------------------------------------------
// Tests — SSE event.type injection into parsed data
// ---------------------------------------------------------------------------

describe("useEventStream — event.type injection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    MockEventSource.instances = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function mount(onEvent: (d: unknown) => void, eventTypes = ["recompute_complete"]) {
    act(() => {
      root.render(createElement(Wrapper, { eventTypes, onEvent }));
    });
    return MockEventSource.instances.at(-1)!;
  }

  it("injects SSE frame event.type into parsed JSON data", () => {
    const onEvent = vi.fn();
    const es = mount(onEvent);

    const payload = { accountId: "acc-1", symbol: "AAPL" };

    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify(payload),
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledOnce();
    const received = onEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(received.type).toBe("recompute_complete");
    expect(received.accountId).toBe("acc-1");
    expect(received.symbol).toBe("AAPL");
  });

  it("preserves all JSON data fields alongside injected type", () => {
    const onEvent = vi.fn();
    const es = mount(onEvent);

    const payload = { accountId: "acc-2", symbol: "TSLA", extra: 42, nested: { a: 1 } };

    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify(payload),
        lastEventId: "2",
      } as unknown as MessageEvent);
    });

    const received = onEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(received).toEqual({
      type: "recompute_complete",
      accountId: "acc-2",
      symbol: "TSLA",
      extra: 42,
      nested: { a: 1 },
    });
  });

  it("event.type from SSE frame overrides type inside JSON payload", () => {
    const onEvent = vi.fn();
    const es = mount(onEvent);

    // JSON payload has a conflicting type field — SSE frame type should win
    const payload = { type: "wrong_type", accountId: "acc-3", symbol: "GOOG" };

    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify(payload),
        lastEventId: "3",
      } as unknown as MessageEvent);
    });

    const received = onEvent.mock.calls[0][0] as Record<string, unknown>;
    // SSE frame type wins because spread puts event.type last
    expect(received.type).toBe("recompute_complete");
  });
});

// ---------------------------------------------------------------------------
// Tests — QA: additional type forwarding coverage
// ---------------------------------------------------------------------------

describe("useEventStream — QA type forwarding coverage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    MockEventSource.instances = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("forwards correct type for each event when multiple eventTypes are registered", () => {
    const onEvent = vi.fn();
    act(() => {
      root.render(
        createElement(QAWrapper, {
          eventTypes: ["recompute_complete", "recompute_failed"],
          onEvent,
        }),
      );
    });
    const es = MockEventSource.instances.at(-1)!;

    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify({ accountId: "a1", symbol: "AAPL" }),
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    act(() => {
      es._fire("recompute_failed", {
        type: "recompute_failed",
        data: JSON.stringify({ accountId: "a2", symbol: "TSLA", reason: "timeout", retriesExhausted: false }),
        lastEventId: "2",
      } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    const first = onEvent.mock.calls[0][0] as Record<string, unknown>;
    const second = onEvent.mock.calls[1][0] as Record<string, unknown>;
    expect(first.type).toBe("recompute_complete");
    expect(first.accountId).toBe("a1");
    expect(second.type).toBe("recompute_failed");
    expect(second.reason).toBe("timeout");
  });

  it("heartbeat events do NOT trigger onEvent", () => {
    const onEvent = vi.fn();
    act(() => {
      root.render(
        createElement(QAWrapper, {
          eventTypes: ["recompute_complete"],
          onEvent,
        }),
      );
    });
    const es = MockEventSource.instances.at(-1)!;

    // Fire heartbeat — should be handled by the heartbeat listener, not onEvent
    act(() => {
      es._fire("heartbeat", {
        type: "heartbeat",
        data: JSON.stringify({}),
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    // Fire a domain event — this should trigger onEvent
    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify({ accountId: "a1", symbol: "AAPL" }),
        lastEventId: "2",
      } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect((onEvent.mock.calls[0][0] as Record<string, unknown>).type).toBe("recompute_complete");
  });

  it("non-JSON payload passes raw string without type injection", () => {
    const onEvent = vi.fn();
    act(() => {
      root.render(
        createElement(QAWrapper, {
          eventTypes: ["recompute_complete"],
          onEvent,
        }),
      );
    });
    const es = MockEventSource.instances.at(-1)!;

    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: "plain text, not JSON",
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledOnce();
    // catch branch passes event.data as-is — raw string, no object wrapping
    expect(onEvent.mock.calls[0][0]).toBe("plain text, not JSON");
  });

  it("type forwarding works after an error event", () => {
    const onEvent = vi.fn();
    act(() => {
      root.render(
        createElement(QAWrapper, {
          eventTypes: ["recompute_complete"],
          onEvent,
        }),
      );
    });
    const es = MockEventSource.instances.at(-1)!;

    // Simulate connection open, then error
    act(() => es._fire("open"));
    act(() => es._fireError());

    // Fire a domain event after the error
    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify({ accountId: "a1", symbol: "MSFT" }),
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledOnce();
    const received = onEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(received.type).toBe("recompute_complete");
    expect(received.symbol).toBe("MSFT");
  });

  it("reconnect gap detection coexists with type injection", () => {
    const onEvent = vi.fn();
    const onReconnect = vi.fn();
    act(() => {
      root.render(
        createElement(QAWrapper, {
          eventTypes: ["recompute_complete"],
          onEvent,
          onReconnect,
        }),
      );
    });
    const es = MockEventSource.instances.at(-1)!;

    // First event — establish lastEventId = 5
    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify({ accountId: "a1", symbol: "AAPL" }),
        lastEventId: "5",
      } as unknown as MessageEvent);
    });

    // Second event — lastEventId resets to 1 (server restart)
    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify({ accountId: "a2", symbol: "GOOG" }),
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    // onReconnect should fire with gap info
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(onReconnect).toHaveBeenCalledWith({ lastReceivedId: 5, currentId: 1 });

    // onEvent should still receive type-injected data for both calls
    expect(onEvent).toHaveBeenCalledTimes(2);
    const second = onEvent.mock.calls[1][0] as Record<string, unknown>;
    expect(second.type).toBe("recompute_complete");
    expect(second.symbol).toBe("GOOG");
  });

  it("deprecated eventType (singular) prop also forwards type", () => {
    const onEvent = vi.fn();
    act(() => {
      root.render(
        createElement(QAWrapper, {
          eventType: "recompute_complete",
          onEvent,
        }),
      );
    });
    const es = MockEventSource.instances.at(-1)!;

    act(() => {
      es._fire("recompute_complete", {
        type: "recompute_complete",
        data: JSON.stringify({ accountId: "a1", symbol: "NVDA" }),
        lastEventId: "1",
      } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledOnce();
    const received = onEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(received.type).toBe("recompute_complete");
    expect(received.symbol).toBe("NVDA");
  });
});
