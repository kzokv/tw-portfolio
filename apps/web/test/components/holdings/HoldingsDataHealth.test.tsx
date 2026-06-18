// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldingsDataHealthBadges } from "../../../components/holdings/HoldingsDataHealth";
import { getDictionary } from "../../../lib/i18n";
import { testPriceState } from "../../fixtures/priceState";

const dict = getDictionary("en");

describe("HoldingsDataHealthBadges", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders the nested price chip as non-interactive text inside the data-health tooltip trigger", async () => {
    act(() => {
      root.render(
        <HoldingsDataHealthBadges
          dict={dict}
          locale="en"
          row={{
            allocationBasisFallbackReason: null,
            allocationBasisUsed: "market_value",
            fxStatus: "complete",
            priceState: testPriceState(),
            quoteStatus: "current",
          }}
        />,
      );
    });

    await act(async () => {});

    const chip = Array.from(container.querySelectorAll("span")).find((node) => node.textContent === "Closed");
    expect(chip).not.toBeUndefined();
    expect(chip?.getAttribute("aria-label")).toBe("Closed");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(chip!.querySelector("button")).toBeNull();
  });

  it("opens the data-health explanation from keyboard focus", async () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        <HoldingsDataHealthBadges
          dict={dict}
          locale="en"
          row={{
            allocationBasisFallbackReason: null,
            allocationBasisUsed: "market_value",
            fxStatus: "complete",
            priceState: testPriceState(),
            quoteStatus: "current",
          }}
        />,
      );
    });

    await act(async () => {});

    const trigger = container.querySelector("button");
    expect(trigger?.getAttribute("aria-label")).toContain("Data health");

    act(() => {
      trigger?.focus();
      vi.advanceTimersByTime(150);
    });

    expect(document.body.querySelector("[role='tooltip']")?.textContent).toContain(dict.holdings.dataHealthDescription);
  });
});
