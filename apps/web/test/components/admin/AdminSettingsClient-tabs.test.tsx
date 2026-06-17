// KZO-199 iter 3 — Unit tests for the AdminSettingsClient tab switcher.
//
// Coverage focuses on the LOW-1 finding from Codex review: the `?tab=<slug>`
// URL guard. An invalid slug (or absent slug) MUST resolve to the default
// `rate-limits` panel — never produce undefined behavior.
//
// The default `next/navigation` stub at `test/setup/next-stubs/navigation.ts`
// returns an empty URLSearchParams; this file overrides `useSearchParams`
// per-test via `vi.mock` so we can drive the URL state.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppConfigDto } from "@vakwen/shared-types";

const mockPatchJson = vi.fn();

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  patchJson: (...args: unknown[]) => mockPatchJson(...args),
}));

// `useSearchParams` is per-test mutable. The factory captures a reference
// to the current `params` value; tests reassign it before render.
let mockParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/admin/settings",
  useSearchParams: () => mockParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";
import { buildAppConfigDto } from "../../fixtures/appConfigDto";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildConfig(overrides: Partial<AppConfigDto> = {}): AppConfigDto {
  return buildAppConfigDto({ updatedAt: "2026-05-10T10:00:00.000Z", ...overrides });
}

function panelHidden(slug: string): boolean {
  // Radix Tabs marks inactive forceMount panels via `data-state="inactive"`;
  // our shim layers `data-[state=inactive]:hidden` to hide visually. The
  // data attribute is the load-bearing signal — read it directly so the
  // test isn't entangled with Tailwind class application order.
  const el = document.querySelector(`[data-testid='admin-settings-panel-${slug}']`);
  if (el === null) throw new Error(`panel missing: ${slug}`);
  return el.getAttribute("data-state") === "inactive";
}

describe("AdminSettingsClient — tab guard (KZO-199 iter 3 LOW-1)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockPatchJson.mockReset();
    mockReplace.mockReset();
    mockParams = new URLSearchParams();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("falls back to rate-limits when ?tab is absent", () => {
    mockParams = new URLSearchParams();
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(panelHidden("rate-limits")).toBe(false);
    expect(panelHidden("sharing")).toBe(true);
    expect(panelHidden("provider-health")).toBe(true);
    expect(panelHidden("backfill-repair")).toBe(true);
    expect(panelHidden("catalog-metadata")).toBe(true);
  });

  it("renders the grouped ticker price freshness close-refresh rate-limit controls", () => {
    mockParams = new URLSearchParams();
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(document.querySelector("[data-testid='admin-settings-ticker-price-freshness-section']")).not.toBeNull();
    expect(document.querySelector("[data-testid='admin-settings-input-tickerPriceRefreshCloseRateLimitWindowMs']")).not.toBeNull();
    expect(document.querySelector("[data-testid='admin-settings-input-tickerPriceRefreshCloseRateLimitMax']")).not.toBeNull();
  });

  it("saves only patchable ticker price freshness fields", async () => {
    const updated = buildConfig();
    mockPatchJson.mockResolvedValueOnce(updated);
    mockParams = new URLSearchParams();
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    const saveButton = document.querySelector(
      "[data-testid='admin-settings-save-ticker-price-freshness']",
    ) as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockPatchJson).toHaveBeenCalledTimes(1);
    const [path, payload] = mockPatchJson.mock.calls[0] as [string, { tickerPriceFreshness: Record<string, unknown> }];
    expect(path).toBe("/admin/settings");
    expect(Object.keys(payload.tickerPriceFreshness).sort()).toEqual([
      "closeRefreshGraceMinutes",
      "intradayEnabled",
      "intradayFreshnessToleranceMinutes",
      "intradayRefreshIntervalMinutes",
      "maxTickersPerRefreshCycle",
      "queueConcurrency",
      "refreshCloseRateLimitMax",
      "refreshCloseRateLimitWindowMs",
      "regularSessionOnly",
      "supportedMarkets",
      "syncTickerCap",
      "yahooChartInterval",
      "yahooChartRange",
      "yahooChartRequestLimitPerMinute",
    ].sort());
    expect(payload.tickerPriceFreshness).not.toHaveProperty("effectiveCloseRefreshGraceMinutes");
    expect(payload.tickerPriceFreshness).not.toHaveProperty("options");
    expect(payload.tickerPriceFreshness).not.toHaveProperty("bounds");
  });

  it("falls back to rate-limits when ?tab=<bogus-slug>", () => {
    mockParams = new URLSearchParams({ tab: "totally-not-a-real-slug" });
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(panelHidden("rate-limits")).toBe(false);
    expect(panelHidden("sharing")).toBe(true);
  });

  it("falls back to rate-limits when ?tab is empty string", () => {
    mockParams = new URLSearchParams({ tab: "" });
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(panelHidden("rate-limits")).toBe(false);
  });

  it("activates the sharing panel when ?tab=sharing is in the URL", () => {
    mockParams = new URLSearchParams({ tab: "sharing" });
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(panelHidden("sharing")).toBe(false);
    expect(panelHidden("rate-limits")).toBe(true);
  });

  it("activates the catalog-metadata panel when ?tab=catalog-metadata is in the URL", () => {
    mockParams = new URLSearchParams({ tab: "catalog-metadata" });
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(panelHidden("catalog-metadata")).toBe(false);
    expect(panelHidden("rate-limits")).toBe(true);
  });

  it("renders provider operation policy and retention settings in the provider-health tab", () => {
    mockParams = new URLSearchParams({ tab: "provider-health" });
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    expect(panelHidden("provider-health")).toBe(false);
    expect(document.body.textContent).toContain("Provider operation automation");
    expect(document.body.textContent).toContain("Auto-renew interval");
    expect(document.body.textContent).toContain("Provider health thresholds");
    expect(document.body.textContent).toContain("Warning unresolved threshold");
    expect(document.body.textContent).toContain("Provider retention");
    expect(document.body.textContent).toContain("Operation summary retention");
    expect(document.querySelector("[data-testid='admin-settings-providerOperationAutoRenewIntervalMinutes-row']")).not.toBeNull();
    expect(document.querySelector("[data-testid='admin-settings-providerResolvedItemRetentionDays-row']")).not.toBeNull();
  });
});
