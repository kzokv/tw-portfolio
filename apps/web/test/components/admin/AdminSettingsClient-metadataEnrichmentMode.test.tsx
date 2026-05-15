// KZO-189 — QA unit tests for the "Metadata Enrichment Mode" section
// added to AdminSettingsClient.
//
// Coverage: select rendering (3 options), effective-value display,
// Save round-trip (unconditional + null), success toast, error toast.
//
// Repair-cooldown and Timeframe-defaults sections are covered by sibling
// test files; this file only exercises the new Mode section.

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

import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";
import { ApiError } from "../../../lib/api";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

// KZO-198 — delegate to shared fixture so the 22 new fields are populated.
import { buildAppConfigDto } from "../../fixtures/appConfigDto";

function buildConfig(overrides: Partial<AppConfigDto> = {}): AppConfigDto {
  return buildAppConfigDto({ updatedAt: "2026-05-06T10:00:00.000Z", ...overrides });
}

function click(testId: string) {
  const el = document.querySelector(`[data-testid='${testId}']`) as HTMLElement | null;
  if (!el) throw new Error(`element not found: ${testId}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function selectValue(testId: string, value: string) {
  const el = document.querySelector(`[data-testid='${testId}']`) as HTMLSelectElement | null;
  if (!el) throw new Error(`select not found: ${testId}`);
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  act(() => {
    nativeSetter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("AdminSettingsClient — Metadata Enrichment Mode (KZO-189)", () => {
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

  it("renders the section root with select and 3 options (env-default, unconditional, conditional)", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    const section = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-section']",
    );
    expect(section).not.toBeNull();

    const select = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-select']",
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options).toHaveLength(3);
    expect(select.options[0]!.value).toBe("");
    expect(select.options[1]!.value).toBe("unconditional");
    expect(select.options[2]!.value).toBe("conditional");
  });

  it("renders select with empty value when metadataEnrichmentMode is null (env default)", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig({ metadataEnrichmentMode: null })} />));

    const select = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-select']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("renders select with 'unconditional' value when metadataEnrichmentMode is set", () => {
    act(() =>
      root.render(
        <AdminSettingsClient initial={buildConfig({ metadataEnrichmentMode: "unconditional" })} />,
      ),
    );

    const select = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-select']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("unconditional");
  });

  it("renders effective mode display with '(env default)' suffix when metadataEnrichmentMode is null", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    const effective = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-effective']",
    );
    expect(effective?.textContent).toContain("conditional");
    expect(effective?.textContent).toContain("(env default)");
  });

  it("renders effective mode display with '(admin override)' suffix when metadataEnrichmentMode is set", () => {
    act(() =>
      root.render(
        <AdminSettingsClient
          initial={buildConfig({
            metadataEnrichmentMode: "unconditional",
            effectiveMetadataEnrichmentMode: "unconditional",
          })}
        />,
      ),
    );

    const effective = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-effective']",
    );
    expect(effective?.textContent).toContain("unconditional");
    expect(effective?.textContent).toContain("(admin override)");
  });

  it("changing select updates UI state (reflected in select.value)", () => {
    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));

    selectValue("admin-settings-metadata-enrichment-mode-select", "unconditional");

    const select = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-select']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("unconditional");
  });

  it("Save with 'unconditional' selected sends PATCH body { metadataEnrichmentMode: 'unconditional' }", async () => {
    const updated = buildConfig({
      metadataEnrichmentMode: "unconditional",
      effectiveMetadataEnrichmentMode: "unconditional",
    });
    mockPatchJson.mockResolvedValueOnce(updated);

    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    selectValue("admin-settings-metadata-enrichment-mode-select", "unconditional");
    click("admin-settings-metadata-enrichment-mode-save");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPatchJson).toHaveBeenCalledWith("/admin/settings", {
      metadataEnrichmentMode: "unconditional",
    });
  });

  it("Save with env-default ('') selected sends PATCH body { metadataEnrichmentMode: null }", async () => {
    const updated = buildConfig({
      metadataEnrichmentMode: null,
      effectiveMetadataEnrichmentMode: "conditional",
    });
    mockPatchJson.mockResolvedValueOnce(updated);

    act(() =>
      root.render(
        <AdminSettingsClient
          initial={buildConfig({ metadataEnrichmentMode: "unconditional" })}
        />,
      ),
    );
    selectValue("admin-settings-metadata-enrichment-mode-select", "");
    click("admin-settings-metadata-enrichment-mode-save");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPatchJson).toHaveBeenCalledWith("/admin/settings", {
      metadataEnrichmentMode: null,
    });
  });

  it("success toast renders after successful Save", async () => {
    const updated = buildConfig({ metadataEnrichmentMode: "unconditional" });
    mockPatchJson.mockResolvedValueOnce(updated);

    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    selectValue("admin-settings-metadata-enrichment-mode-select", "unconditional");
    click("admin-settings-metadata-enrichment-mode-save");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const success = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-success']",
    );
    expect(success).not.toBeNull();
    expect(success?.textContent).toContain("saved");
  });

  it("error toast renders when PATCH returns a 500 error", async () => {
    mockPatchJson.mockRejectedValueOnce(new ApiError("server_error", 500));

    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    click("admin-settings-metadata-enrichment-mode-save");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const error = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-error']",
    );
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("server_error");
  });

  it("error toast renders when PATCH returns a 400 ApiError", async () => {
    mockPatchJson.mockRejectedValueOnce(
      new ApiError("invalid_metadata_enrichment_mode", 400, "invalid_metadata_enrichment_mode"),
    );

    act(() => root.render(<AdminSettingsClient initial={buildConfig()} />));
    selectValue("admin-settings-metadata-enrichment-mode-select", "unconditional");
    click("admin-settings-metadata-enrichment-mode-save");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const error = document.querySelector(
      "[data-testid='admin-settings-metadata-enrichment-mode-error']",
    );
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("invalid_metadata_enrichment_mode");
  });
});
