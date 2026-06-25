import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import TickerError from "../../../app/tickers/[ticker]/error";
import { getDictionary } from "../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("TickerError", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.lang = "zh-TW";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.lang = "en";
    vi.clearAllMocks();
  });

  it("renders zh-TW app error copy and retries through reset", () => {
    const reset = vi.fn();
    const copy = getDictionary("zh-TW").appError;

    act(() => {
      root.render(<TickerError error={new Error("boom")} reset={reset} />);
    });

    expect(document.body.textContent).toContain(copy.title);
    const button = container.querySelector("button");
    expect(button?.textContent).toBe(copy.retry);

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
