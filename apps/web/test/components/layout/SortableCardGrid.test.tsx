// KZO-161 (158C) — Unit tests for SortableCardGrid and mergeCardOrder.
//
// Covers (per design doc §5, §6, §16):
//   1. mergeCardOrder: canonical ⋈ user-order algorithm (unknown slugs dropped, new appended)
//   2. SortableCardGrid: debounced PATCH coalescing (multiple drags → single PATCH)
//   3. SortableCardGrid: optimistic rollback — PATCH failure restores last server-confirmed order
//
// These are TDD-red until the implementation lands. The import paths match
// the design doc §2 "New files" table.
//
// Notes:
//  - Tests are intentionally scoped to the pure-function and hook logic.
//    dnd-kit drag events are not simulated here (no jsdom DnD API);
//    drag-event logic is exercised via E2E specs (card-reorder-aaa.spec.ts).
//  - Vitest environment: jsdom (apps/web/vitest.config.ts).

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// ── Imports from the component under test ─────────────────────────────────────
// These paths are TDD-red until the implementation lands; they match the design
// doc §2 "New files" table exactly.

// The pure merge function and component are TDD-red until the implementation
// lands. The export names match the design doc §2 "New files" table.
import { mergeCardOrder, SortableCardGrid } from "../../../components/layout/SortableCardGrid.js";

// Local type mirror for card spec. Matches the design-doc § contract:
// { slug: string; fullWidth: boolean }. Import from the module once
// the Implementer exports it; for now defined here to avoid TS2724.
type CardSpec = { slug: string; fullWidth: boolean };

// ── mergeCardOrder: pure function tests ──────────────────────────────────────

describe("mergeCardOrder", () => {
  const CANONICAL: readonly CardSpec[] = [
    { slug: "portfolio-trend",     fullWidth: false },
    { slug: "allocation-snapshot", fullWidth: false },
    { slug: "return-percent",      fullWidth: false },
    { slug: "holdings-table",      fullWidth: true  },
    { slug: "dividends-section",   fullWidth: true  },
  ] as const;

  it("returns canonical order when userOrder is null", () => {
    const result = mergeCardOrder(CANONICAL, null);
    expect(result.map((c: CardSpec) => c.slug)).toEqual([
      "portfolio-trend",
      "allocation-snapshot",
      "return-percent",
      "holdings-table",
      "dividends-section",
    ]);
  });

  it("returns canonical order when userOrder is undefined", () => {
    const result = mergeCardOrder(CANONICAL, undefined);
    expect(result.map((c: CardSpec) => c.slug)).toEqual([
      "portfolio-trend",
      "allocation-snapshot",
      "return-percent",
      "holdings-table",
      "dividends-section",
    ]);
  });

  it("returns canonical order when userOrder is empty array", () => {
    const result = mergeCardOrder(CANONICAL, []);
    expect(result.map((c: CardSpec) => c.slug)).toEqual([
      "portfolio-trend",
      "allocation-snapshot",
      "return-percent",
      "holdings-table",
      "dividends-section",
    ]);
  });

  it("reorders by user preference when all slugs are valid", () => {
    const userOrder = [
      "holdings-table",
      "portfolio-trend",
      "dividends-section",
      "allocation-snapshot",
      "return-percent",
    ];
    const result = mergeCardOrder(CANONICAL, userOrder);
    expect(result.map((c: CardSpec) => c.slug)).toEqual(userOrder);
  });

  it("preserves fullWidth metadata after reorder", () => {
    const userOrder = ["holdings-table", "portfolio-trend"];
    // Merge with only 2 slugs — the others are appended at the end.
    const result = mergeCardOrder(CANONICAL, userOrder);
    // holdings-table is fullWidth=true; portfolio-trend is fullWidth=false.
    expect(result[0]).toEqual({ slug: "holdings-table", fullWidth: true });
    expect(result[1]).toEqual({ slug: "portfolio-trend", fullWidth: false });
  });

  it("silently drops unknown slugs from userOrder", () => {
    const userOrder = [
      "ghost-card",            // not in canonical — dropped
      "portfolio-trend",
      "another-unknown-slug",  // not in canonical — dropped
      "holdings-table",
    ];
    const result = mergeCardOrder(CANONICAL, userOrder);
    // ghost-card and another-unknown-slug are dropped.
    // Unmentioned canonical slugs are appended at the end.
    const slugs = result.map((c: CardSpec) => c.slug);
    expect(slugs).not.toContain("ghost-card");
    expect(slugs).not.toContain("another-unknown-slug");
    expect(slugs[0]).toBe("portfolio-trend");
    expect(slugs[1]).toBe("holdings-table");
  });

  it("appends new canonical slugs at the end of user-known slugs", () => {
    // User has never seen "dividends-section" or "return-percent"
    // (e.g. they saved a prior order before these cards existed).
    const userOrder = ["holdings-table", "portfolio-trend", "allocation-snapshot"];
    const result = mergeCardOrder(CANONICAL, userOrder);
    const slugs = result.map((c: CardSpec) => c.slug);
    // Known slugs in user order come first.
    expect(slugs.slice(0, 3)).toEqual(["holdings-table", "portfolio-trend", "allocation-snapshot"]);
    // New canonical slugs appended at end (order among appended matches canonical).
    expect(slugs.slice(3)).toContain("return-percent");
    expect(slugs.slice(3)).toContain("dividends-section");
  });

  it("is idempotent when called twice with the same inputs", () => {
    const userOrder = ["holdings-table", "portfolio-trend", "allocation-snapshot", "return-percent", "dividends-section"];
    const first = mergeCardOrder(CANONICAL, userOrder).map((c: CardSpec) => c.slug);
    const second = mergeCardOrder(CANONICAL, userOrder).map((c: CardSpec) => c.slug);
    expect(first).toEqual(second);
  });
});

// ── SortableCardGrid component: PATCH debounce + rollback ──────────────────

// Global `fetch` is stubbed at the test level to simulate PATCH responses.
// The component reads user order via GET /user-preferences on mount, then
// PATCH /user-preferences on drag end.

const CANONICAL_CARDS: readonly CardSpec[] = [
  { slug: "portfolio-trend",     fullWidth: false },
  { slug: "allocation-snapshot", fullWidth: false },
  { slug: "return-percent",      fullWidth: false },
] as const;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("SortableCardGrid — debounced PATCH coalescing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: MockedFunction<typeof fetch>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Stub fetch: GET returns empty prefs; PATCH returns 200.
    fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
      if (url.includes("/user-preferences") && !url.includes("effective")) {
        if (fetchMock.mock.calls.find(c => String(c[0]).includes("user-preferences") && (c[1] as RequestInit)?.method === "PATCH")) {
          // PATCH call
          return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
        }
        // GET call
        return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("multiple onPersist calls within debounce window coalesce to one PATCH", async () => {
    // Render the grid component.
    // Expose onPersist via testId interaction:
    // Since we can't simulate dnd-kit drag events in jsdom, we test the
    // debounce machinery via the component's internal _triggerPersistForTest
    // export (test-only escape hatch, or we test the hook directly).
    //
    // If the component does NOT export a test escape hatch, this test verifies
    // the observed PATCH call count is ≤ 1 after multiple rapid state updates.
    //
    // The design doc §5 says: "Multiple drags within debounce window coalesce
    // to one PATCH with the final state."
    //
    // Implementation note: this test is intentionally structural — it confirms
    // the debounce contract via the PATCH call count, not via drag events.

    let patchCount = 0;

    // Override fetch to count PATCH calls.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
      if (url.includes("/user-preferences")) {
        if (init?.method === "PATCH") {
          patchCount++;
          return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
        }
        // GET — return empty prefs.
        return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
      }
      return new Response("", { status: 200 });
    }));

    const onPersistFailure = vi.fn();

    act(() => {
      root.render(
        <SortableCardGrid
          cards={CANONICAL_CARDS}
          orderKey="dashboard"
          onPersistFailure={onPersistFailure}
        >
          {(slug: string) => <div data-testid={`card-inner-${slug}`}>{slug}</div>}
        </SortableCardGrid>,
      );
    });

    // Allow mount GET to resolve.
    await act(async () => {
      await Promise.resolve();
    });

    // Simulate multiple rapid drag completions via the `_testOnDragEnd`
    // escape hatch exposed by the component (design-doc §5 test contract —
    // jsdom cannot fire dnd-kit PointerSensor events, so drag behaviour is
    // exercised via E2E; this test drives the debounce/rollback state
    // machine directly).
    const gridEl = container.querySelector("[data-testid='sortable-card-grid']");
    expect(gridEl, "grid element exists with sortable-card-grid testid").not.toBeNull();
    const trigger = (gridEl as HTMLElement & { _testOnDragEnd: (order: string[]) => void })
      ._testOnDragEnd;
    expect(typeof trigger, "_testOnDragEnd escape hatch is a function").toBe("function");

    act(() => {
      trigger(["allocation-snapshot", "portfolio-trend", "return-percent"]);
      trigger(["return-percent", "portfolio-trend", "allocation-snapshot"]);
      trigger(["portfolio-trend", "return-percent", "allocation-snapshot"]);
    });

    // Advance timers past the debounce window (250ms).
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    // Exactly 1 PATCH should have been made (coalesced).
    expect(patchCount, "debounce coalesces multiple drags to 1 PATCH").toBe(1);
  });
});

describe("SortableCardGrid — optimistic rollback on PATCH failure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("restores display order to last-server-confirmed state on PATCH 500", async () => {
    // Stub GET to return a pre-seeded user order; stub PATCH to fail with 500.
    const seededOrder = ["holdings-table", "portfolio-trend", "return-percent"];

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
      if (url.includes("/user-preferences")) {
        if (init?.method === "PATCH") {
          // Always fail.
          return new Response(JSON.stringify({ error: "injected failure" }), { status: 500 });
        }
        // GET — return the seeded order.
        return new Response(
          JSON.stringify({
            preferences: { cardOrder: { dashboard: seededOrder } },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 200 });
    }));

    const onPersistFailure = vi.fn();

    const CARDS_WITH_HOLDINGS: readonly CardSpec[] = [
      { slug: "holdings-table",      fullWidth: true  },
      { slug: "portfolio-trend",     fullWidth: false },
      { slug: "return-percent",      fullWidth: false },
    ];

    act(() => {
      root.render(
        <SortableCardGrid
          cards={CARDS_WITH_HOLDINGS}
          orderKey="dashboard"
          onPersistFailure={onPersistFailure}
        >
          {(slug: string) => <div data-testid={`card-inner-${slug}`}>{slug}</div>}
        </SortableCardGrid>,
      );
    });

    // Allow mount GET to resolve — grid should display seededOrder.
    await act(async () => {
      await Promise.resolve();
    });

    // Verify initial render order matches seeded order.
    // Filter out the `card-drag-handle-{slug}` sibling testids that the
    // design (§5) requires for drag affordance — we only want the card
    // root wrappers here.
    // Filter out the `card-drag-handle-{slug}` sibling testids that the
    // design (§5) requires for drag affordance AND the `card-inner-{slug}`
    // stand-in testids this test uses for fake render-prop children — we
    // only want the grid's outer card wrappers here.
    const getCardOrder = () => {
      const cards = container.querySelectorAll("[data-testid^='card-']");
      return Array.from(cards)
        .map((el) => el.getAttribute("data-testid") ?? "")
        .filter(
          (tid) =>
            !tid.startsWith("card-drag-handle-") &&
            !tid.startsWith("card-inner-"),
        )
        .map((tid) => tid.replace("card-", ""));
    };

    expect(getCardOrder(), "initial render matches seeded order").toEqual(seededOrder);

    // Simulate a drag via the `_testOnDragEnd` escape hatch.
    const gridEl = container.querySelector("[data-testid='sortable-card-grid']");
    expect(gridEl, "grid element exists with sortable-card-grid testid").not.toBeNull();
    const trigger = (gridEl as HTMLElement & { _testOnDragEnd: (order: string[]) => void })
      ._testOnDragEnd;
    expect(typeof trigger, "_testOnDragEnd escape hatch is a function").toBe("function");

    // Drag to a different order (optimistic UI update).
    act(() => {
      trigger(["portfolio-trend", "holdings-table", "return-percent"]);
    });

    // Optimistic UI: order changes immediately.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getCardOrder(), "optimistic order after drag").toEqual([
      "portfolio-trend",
      "holdings-table",
      "return-percent",
    ]);

    // Advance past debounce — PATCH fires and fails.
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    // After PATCH failure: order reverts to last-server-confirmed state.
    expect(getCardOrder(), "order reverts to server-confirmed after PATCH failure").toEqual(seededOrder);

    // onPersistFailure callback was called.
    expect(onPersistFailure, "onPersistFailure called on PATCH failure").toHaveBeenCalled();
  });

  it("uses last-server-confirmed state (not pre-drag) as rollback baseline for multiple drags", async () => {
    // This test verifies the design doc §7 decision:
    // "Snapshot policy = last server-confirmed state, not pre-drag."
    //
    // Scenario:
    //   1. Server confirms order [A, B, C].
    //   2. User drags to [B, A, C] → PATCH succeeds → server-confirmed = [B, A, C].
    //   3. User drags to [C, A, B] → PATCH fails.
    //   4. Rollback should go to [B, A, C] (last server-confirmed), NOT [A, B, C] (original).

    let patchCount = 0;

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
      if (url.includes("/user-preferences")) {
        if (init?.method === "PATCH") {
          patchCount++;
          if (patchCount === 1) {
            // First PATCH succeeds — confirms [B, A, C].
            return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
          }
          // Second PATCH fails.
          return new Response(JSON.stringify({ error: "injected failure" }), { status: 500 });
        }
        // GET — original order [A, B, C].
        return new Response(
          JSON.stringify({ preferences: { cardOrder: { dashboard: ["card-a", "card-b", "card-c"] } } }),
          { status: 200 },
        );
      }
      return new Response("", { status: 200 });
    }));

    const CARDS_ABC: readonly CardSpec[] = [
      { slug: "card-a", fullWidth: false },
      { slug: "card-b", fullWidth: false },
      { slug: "card-c", fullWidth: false },
    ];

    const onPersistFailure = vi.fn();

    act(() => {
      root.render(
        <SortableCardGrid
          cards={CARDS_ABC}
          orderKey="dashboard"
          onPersistFailure={onPersistFailure}
        >
          {(slug: string) => <div data-testid={`card-inner-${slug}`}>{slug}</div>}
        </SortableCardGrid>,
      );
    });

    await act(async () => { await Promise.resolve(); });

    // Filter out `card-drag-handle-*` and `card-inner-*` testids so we only
    // count the grid's outer card wrappers (same pattern as the rollback test).
    const getCardOrder = () => {
      const cards = container.querySelectorAll("[data-testid^='card-']");
      return Array.from(cards)
        .map((el) => el.getAttribute("data-testid") ?? "")
        .filter(
          (tid) =>
            !tid.startsWith("card-drag-handle-") &&
            !tid.startsWith("card-inner-"),
        )
        .map((tid) => tid.replace("card-", ""));
    };

    const gridEl = container.querySelector("[data-testid='sortable-card-grid']");
    expect(gridEl, "grid element exists with sortable-card-grid testid").not.toBeNull();
    const trigger = (gridEl as HTMLElement & { _testOnDragEnd: (order: string[]) => void })
      ._testOnDragEnd;
    expect(typeof trigger, "_testOnDragEnd escape hatch is a function").toBe("function");

    // First drag → [B, A, C].
    act(() => trigger(["card-b", "card-a", "card-c"]));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    // First PATCH succeeds — server-confirmed = [B, A, C].
    expect(patchCount, "first PATCH fired").toBe(1);

    // Second drag → [C, A, B].
    act(() => trigger(["card-c", "card-a", "card-b"]));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    // Second PATCH fails.
    expect(patchCount, "second PATCH fired").toBe(2);

    // After failure: rollback to last server-confirmed [B, A, C], not original [A, B, C].
    expect(getCardOrder(), "rollback to last server-confirmed (not pre-drag original)").toEqual([
      "card-b",
      "card-a",
      "card-c",
    ]);
  });
});
