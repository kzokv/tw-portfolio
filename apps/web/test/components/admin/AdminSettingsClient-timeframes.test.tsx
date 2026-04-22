// KZO-159 (158A) — Frontend Implementer unit tests for the
// "Dashboard Timeframe Defaults" section added to AdminSettingsClient.
//
// Coverage: chip toggling, up/down reorder, custom range validation
// (invalid format / duplicate), Save (PATCH with array) and Reset
// (PATCH with null) round-trips, server 400 echoed to validation slot.
//
// Repair-cooldown behaviour from the existing section is left untouched —
// these tests only exercise the new Timeframe section.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppConfigDto } from "@tw-portfolio/shared-types";

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

import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";
import { ApiError } from "../../../lib/api";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildConfig(overrides: Partial<AppConfigDto> = {}): AppConfigDto {
  return {
    repairCooldownMinutes: null,
    effectiveRepairCooldownMinutes: 15,
    dashboardPerformanceRanges: null,
    effectiveDashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y"],
    updatedAt: "2026-04-22T10:00:00.000Z",
    ...overrides,
  };
}

function click(testId: string) {
  const el = document.querySelector(`[data-testid='${testId}']`) as HTMLElement | null;
  if (!el) throw new Error(`element not found: ${testId}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function input(testId: string, value: string) {
  const el = document.querySelector(`[data-testid='${testId}']`) as HTMLInputElement | null;
  if (!el) throw new Error(`input not found: ${testId}`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function activeChipOrder(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="timeframe-chip-"][data-active="true"]'),
  ).map((el) => el.textContent?.trim() ?? "");
}

describe("AdminSettingsClient — Dashboard Timeframe Defaults", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockPatchJson.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the section root and the helper text", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    const section = document.querySelector("[data-testid='timeframe-defaults-section']");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain(
      "Users can override these defaults in their own Display Preferences.",
    );
  });

  it("uses DEFAULT_DASHBOARD_PERFORMANCE_RANGES as initial active list when admin config is null", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    expect(activeChipOrder()).toEqual(["1M", "3M", "YTD", "1Y"]);
    // Predefined-but-not-active palette renders 5Y + 10Y
    expect(
      document.querySelector('[data-testid="timeframe-chip-5Y"][data-active="false"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="timeframe-chip-10Y"][data-active="false"]'),
    ).not.toBeNull();
  });

  it("renders saved admin overrides as the initial active list", () => {
    act(() =>
      root.render(
        <AdminSettingsClient
          initial={buildConfig({ dashboardPerformanceRanges: ["YTD", "1Y", "5Y"] })}
        />,
      ),
    );
    expect(activeChipOrder()).toEqual(["YTD", "1Y", "5Y"]);
  });

  it("toggling an active chip removes it from the pending list", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("timeframe-chip-3M");
    expect(activeChipOrder()).toEqual(["1M", "YTD", "1Y"]);
  });

  it("toggling an available chip adds it (appended) to the pending list", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("timeframe-chip-5Y");
    expect(activeChipOrder()).toEqual(["1M", "3M", "YTD", "1Y", "5Y"]);
  });

  it("up arrow swaps the chip with the previous one", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("timeframe-chip-up-YTD");
    expect(activeChipOrder()).toEqual(["1M", "YTD", "3M", "1Y"]);
  });

  it("down arrow swaps the chip with the next one", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("timeframe-chip-down-1M");
    expect(activeChipOrder()).toEqual(["3M", "1M", "YTD", "1Y"]);
  });

  it("up arrow on the first chip is disabled (no-op)", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    const upBtn = document.querySelector(
      "[data-testid='timeframe-chip-up-1M']",
    ) as HTMLButtonElement;
    expect(upBtn.disabled).toBe(true);
  });

  it("down arrow on the last chip is disabled (no-op)", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    const downBtn = document.querySelector(
      "[data-testid='timeframe-chip-down-1Y']",
    ) as HTMLButtonElement;
    expect(downBtn.disabled).toBe(true);
  });

  it("invalid custom range shows validation error and disables Add", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    input("timeframe-add-input", "0M");
    const errorEl = document.querySelector("[data-testid='timeframe-validation-error']");
    expect(errorEl?.textContent).toContain("Invalid range format");
    const addBtn = document.querySelector(
      "[data-testid='timeframe-add-button']",
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it("duplicate custom range shows duplicate error and disables Add", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    input("timeframe-add-input", "1M");
    const errorEl = document.querySelector("[data-testid='timeframe-validation-error']");
    expect(errorEl?.textContent).toContain("already in the list");
    const addBtn = document.querySelector(
      "[data-testid='timeframe-add-button']",
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it("valid custom range Add appends to active list and clears input", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    input("timeframe-add-input", "18M");
    click("timeframe-add-button");
    expect(activeChipOrder()).toEqual(["1M", "3M", "YTD", "1Y", "18M"]);
    const inputEl = document.querySelector(
      "[data-testid='timeframe-add-input']",
    ) as HTMLInputElement;
    expect(inputEl.value).toBe("");
  });

  it("Save sends PATCH with the pending array and clears any prior server error", async () => {
    const updated: AppConfigDto = buildConfig({
      dashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y", "5Y"],
      effectiveDashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y", "5Y"],
    });
    mockPatchJson.mockResolvedValueOnce(updated);

    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("timeframe-chip-5Y");
    click("timeframe-save-button");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPatchJson).toHaveBeenCalledWith("/admin/settings", {
      dashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y", "5Y"],
    });
  });

  it("Reset sends PATCH with null and resets pending to defaults on success", async () => {
    const updated: AppConfigDto = buildConfig({
      dashboardPerformanceRanges: null,
      effectiveDashboardPerformanceRanges: ["1M", "3M", "YTD", "1Y"],
    });
    mockPatchJson.mockResolvedValueOnce(updated);

    act(() =>
      root.render(
        <AdminSettingsClient
          initial={buildConfig({ dashboardPerformanceRanges: ["YTD"] })}
        />,
      ),
    );
    click("timeframe-reset-button");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPatchJson).toHaveBeenCalledWith("/admin/settings", {
      dashboardPerformanceRanges: null,
    });
    expect(activeChipOrder()).toEqual(["1M", "3M", "YTD", "1Y"]);
  });

  it("server 400 ApiError on Save echoes message into the validation slot", async () => {
    mockPatchJson.mockRejectedValueOnce(new ApiError("invalid_range_list", 400, "invalid_range_list"));

    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("timeframe-save-button");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const errorEl = document.querySelector("[data-testid='timeframe-validation-error']");
    expect(errorEl?.textContent).toContain("invalid_range_list");
  });

  it("Save button is disabled when the active list is empty", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    // Toggle every default chip off
    click("timeframe-chip-1M");
    click("timeframe-chip-3M");
    click("timeframe-chip-YTD");
    click("timeframe-chip-1Y");
    const saveBtn = document.querySelector(
      "[data-testid='timeframe-save-button']",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    const errorEl = document.querySelector("[data-testid='timeframe-validation-error']");
    expect(errorEl?.textContent).toContain("at least one timeframe");
  });
});
