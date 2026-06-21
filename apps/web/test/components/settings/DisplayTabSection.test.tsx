// KZO-180 — Unit tests for the DisplayTabSection reporting-currency selector.
//
// Covers (per scope-todo Phase 6 + the team-lead task description):
//   1. Initial GET /user-preferences hydration → dropdown reflects saved value
//   2. onChange → PATCH fires with { reportingCurrency: "USD" }
//   3. PATCH success → saved-flash renders briefly
//   4. PATCH failure → saved-flash does NOT render; UI rolls back to prior value
//
// Notes:
//   - The Layout-section reset-button flows are covered indirectly by the
//     existing E2E suite; this file is scoped to the new selector contract.
//   - Vitest environment: jsdom (apps/web/vitest.config.ts).

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DisplayTabSection } from "../../../components/settings/DisplayTabSection";
import { getDictionary } from "../../../lib/i18n";

const dict = getDictionary("en");

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

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

function teardown({ container, root }: RenderHandle) {
  act(() => root.unmount());
  container.remove();
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function buildFetchMock(opts: {
  initialPrefs?: Record<string, unknown>;
  patchStatus?: number;
  recordCalls: FetchCall[];
}): MockedFunction<typeof fetch> {
  const { initialPrefs = {}, patchStatus = 200, recordCalls } = opts;
  return vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recordCalls.push({ url, method, body });

    if (url.includes("/user-preferences") && !url.includes("effective")) {
      if (method === "PATCH") {
        if (patchStatus >= 400) {
          return new Response(
            JSON.stringify({ error: "patch_failed", message: "PATCH rejected" }),
            { status: patchStatus, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ preferences: initialPrefs }), { status: patchStatus });
      }
      // GET
      return new Response(JSON.stringify({ preferences: initialPrefs }), { status: 200 });
    }
    return new Response("", { status: 200 });
  });
}

describe("DisplayTabSection — reporting currency selector (KZO-180)", () => {
  let handle: RenderHandle;
  let calls: FetchCall[];

  beforeEach(() => {
    handle = makeContainer();
    calls = [];
  });

  afterEach(() => {
    teardown(handle);
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--finance-gain");
    document.documentElement.style.removeProperty("--finance-loss");
    document.documentElement.style.removeProperty("--chart-direction-positive");
    document.documentElement.style.removeProperty("--chart-direction-negative");
  });

  it("hydrates the dropdown from GET /user-preferences", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { reportingCurrency: "USD" },
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
        />,
      );
    });

    // Allow the initial GET to resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = handle.container.querySelector('[data-testid="reporting-currency-select"]') as HTMLSelectElement | null;
    expect(select, "selector renders").not.toBeNull();
    expect(select!.value).toBe("USD");

    const getCall = calls.find((c) => c.method === "GET" && c.url.includes("/user-preferences") && !c.url.includes("effective"));
    expect(getCall, "GET /user-preferences fired on mount").toBeTruthy();
  });

  it("defaults to TWD when prefs have no reportingCurrency key", async () => {
    const fetchMock = buildFetchMock({ initialPrefs: {}, recordCalls: calls });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = handle.container.querySelector('[data-testid="reporting-currency-select"]') as HTMLSelectElement | null;
    expect(select!.value).toBe("TWD");
  });

  it("PATCHes /user-preferences with the chosen currency on change and renders the saved flash", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { reportingCurrency: "TWD" },
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSaved = vi.fn();

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
          onReportingCurrencySaved={onSaved}
        />,
      );
    });
    // Drain initial GET.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = handle.container.querySelector('[data-testid="reporting-currency-select"]') as HTMLSelectElement;
    // Set the underlying value via the React-aware setter, then dispatch change.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    expect(setter, "HTMLSelectElement.value setter is available").toBeTruthy();
    act(() => {
      setter!.call(select, "USD");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Drain the PATCH promise chain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const patchCall = calls.find((c) => c.method === "PATCH" && c.url.includes("/user-preferences"));
    expect(patchCall, "PATCH /user-preferences fired").toBeTruthy();
    expect(patchCall!.body).toEqual({ reportingCurrency: "USD" });

    expect(onSaved).toHaveBeenCalledTimes(1);

    const savedFlash = handle.container.querySelector('[data-testid="reporting-currency-saved"]');
    expect(savedFlash, "saved flash renders after a successful PATCH").not.toBeNull();
    expect(savedFlash!.textContent).toContain(dict.settings.displayReportingCurrencySaved);

    expect(select.value).toBe("USD");
  });

  it("rolls back UI and does NOT render the saved flash when PATCH fails", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { reportingCurrency: "TWD" },
      patchStatus: 500,
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSaved = vi.fn();

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
          onReportingCurrencySaved={onSaved}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = handle.container.querySelector('[data-testid="reporting-currency-select"]') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter!.call(select, "AUD");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Drain the (failing) PATCH promise chain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const savedFlash = handle.container.querySelector('[data-testid="reporting-currency-saved"]');
    expect(savedFlash, "saved flash NOT rendered on PATCH failure").toBeNull();

    expect(onSaved).not.toHaveBeenCalled();

    // UI rolled back to the previously-confirmed value.
    expect(select.value).toBe("TWD");

    // Error message rendered.
    const errorEl = handle.container.querySelector('[data-testid="reporting-currency-error"]');
    expect(errorEl, "error region rendered on PATCH failure").not.toBeNull();
  });

  it("hydrates the gain/loss color convention from GET /user-preferences", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { priceColorConvention: "gain_red_loss_green" },
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const redGainOption = handle.container.querySelector('[data-testid="display-price-color-convention-gain_red_loss_green"]');
    expect(redGainOption?.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--success)");
  });

  it("PATCHes /user-preferences with gain/loss color convention and applies it immediately", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { priceColorConvention: "gain_green_loss_red" },
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const redGainOption = handle.container.querySelector('[data-testid="display-price-color-convention-gain_red_loss_green"]') as HTMLButtonElement | null;
    expect(redGainOption).not.toBeNull();
    act(() => {
      redGainOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const patchCall = calls.find((c) => c.method === "PATCH" && c.url.includes("/user-preferences"));
    expect(patchCall?.body).toEqual({ priceColorConvention: "gain_red_loss_green" });
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--success)");
    expect(handle.container.querySelector('[data-testid="price-color-convention-saved"]')?.textContent)
      .toContain(dict.settings.displayPriceColorConventionSaved);
  });

  it("rolls back gain/loss color convention when PATCH fails", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { priceColorConvention: "gain_green_loss_red" },
      patchStatus: 500,
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      handle.root.render(
        <DisplayTabSection
          dict={dict}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const redGainOption = handle.container.querySelector('[data-testid="display-price-color-convention-gain_red_loss_green"]') as HTMLButtonElement | null;
    act(() => {
      redGainOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const greenGainOption = handle.container.querySelector('[data-testid="display-price-color-convention-gain_green_loss_red"]');
    expect(greenGainOption?.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--success)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--destructive)");
    expect(handle.container.querySelector('[data-testid="price-color-convention-error"]')).not.toBeNull();
  });
});
