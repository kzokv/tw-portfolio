import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AccentApplier, shouldSkipPreferenceHydration } from "../../../components/layout/AccentApplier";
import { applyPriceColorConvention } from "../../../lib/theme";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

interface RenderHandle {
  container: HTMLDivElement;
  root: Root;
}

function makeContainer(): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

describe("AccentApplier", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--finance-gain");
    document.documentElement.style.removeProperty("--finance-loss");
    document.documentElement.style.removeProperty("--chart-direction-positive");
    document.documentElement.style.removeProperty("--chart-direction-negative");
  });

  it("skips preference hydration on public auth and invite surfaces", () => {
    expect(shouldSkipPreferenceHydration("/login")).toBe(true);
    expect(shouldSkipPreferenceHydration("/auth/error")).toBe(true);
    expect(shouldSkipPreferenceHydration("/invite")).toBe(true);
    expect(shouldSkipPreferenceHydration("/invite/CHGGDFXB")).toBe(true);
    expect(shouldSkipPreferenceHydration("/share")).toBe(true);
    expect(shouldSkipPreferenceHydration("/share/public-token")).toBe(true);
  });

  it("hydrates preferences on authenticated app surfaces", () => {
    expect(shouldSkipPreferenceHydration("/dashboard")).toBe(false);
    expect(shouldSkipPreferenceHydration("/settings/profile")).toBe(false);
    expect(shouldSkipPreferenceHydration("/sharing")).toBe(false);
  });

  it("applies the default price color convention when the preference key is missing", async () => {
    applyPriceColorConvention("gain_red_loss_green");
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--success)");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ preferences: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));

    const handle = makeContainer();
    try {
      act(() => {
        handle.root.render(createElement(AccentApplier));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--success)");
      expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--destructive)");
    } finally {
      act(() => handle.root.unmount());
      handle.container.remove();
    }
  });
});
