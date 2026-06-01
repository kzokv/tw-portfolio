import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HoldingAllocationBasis } from "../../../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../../../features/portfolio/hooks/useHoldingAllocationBasis";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
}));

import { getJson, patchJson } from "../../../../lib/api";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useHoldingAllocationBasis>;

function Harness() {
  result = useHoldingAllocationBasis();
  return null;
}

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      clear: () => {
        store.clear();
      },
    },
  });
}

describe("useHoldingAllocationBasis", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    installLocalStorageMock();
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(getJson).mockResolvedValue({ preferences: {} });
    vi.mocked(patchJson).mockResolvedValue({ preferences: {} });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container.remove();
    window.localStorage.clear();
    vi.mocked(getJson).mockReset();
    vi.mocked(patchJson).mockReset();
  });

  async function mount() {
    await act(async () => {
      root!.render(createElement(Harness));
    });
  }

  it("hydrates from server preference when present", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: { holdingAllocationBasis: "cost_basis" },
    });

    await mount();
    await act(async () => {});

    expect(result.allocationBasis).toBe("cost_basis");
    expect(window.localStorage.getItem("vakwen-holdings-allocation-basis")).toBe("cost_basis");
  });

  it("persists user changes to local storage and /user-preferences", async () => {
    await mount();

    act(() => result.setAllocationBasis("cost_basis" satisfies HoldingAllocationBasis));

    expect(result.allocationBasis).toBe("cost_basis");
    expect(window.localStorage.getItem("vakwen-holdings-allocation-basis")).toBe("cost_basis");
    expect(patchJson).toHaveBeenCalledWith("/user-preferences", {
      holdingAllocationBasis: "cost_basis",
    });
  });
});
