import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { AccountMarketDividendSettingsDto } from "@vakwen/shared-types";
import { getDictionary } from "../../../../lib/i18n";

vi.mock("../../../../features/dividends/services/dividendCalculationService", () => ({
  fetchAccountMarketDividendSettings: vi.fn(),
  patchAccountMarketDividendSettings: vi.fn(),
}));

import {
  fetchAccountMarketDividendSettings,
  patchAccountMarketDividendSettings,
} from "../../../../features/dividends/services/dividendCalculationService";
import { AccountDividendSettingsSection } from "../../../../features/settings/components/AccountDividendSettingsSection";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function settings(overrides: Partial<AccountMarketDividendSettingsDto> = {}): AccountMarketDividendSettingsDto {
  return {
    accountId: "acc-1",
    marketCode: "TW",
    version: 0,
    fallbackParValue: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("AccountDividendSettingsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchAccountMarketDividendSettings).mockResolvedValue(settings());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render({
    canManage = true,
    marketCode = "TW",
    focused = false,
  }: {
    canManage?: boolean;
    marketCode?: "TW" | "US";
    focused?: boolean;
  } = {}) {
    await act(async () => {
      root.render(
        <AccountDividendSettingsSection
          accountId="acc-1"
          marketCode={marketCode}
          canManage={canManage}
          dict={dict}
          focused={focused}
        />,
      );
    });
  }

  it("loads an unset TW fallback and saves an explicit par value", async () => {
    vi.mocked(patchAccountMarketDividendSettings).mockResolvedValueOnce(settings({
      version: 1,
      fallbackParValue: "10.00",
      updatedAt: "2026-07-17T04:00:00.000Z",
    }));

    await render();

    expect(container.textContent).toContain("Not configured");
    expect(fetchAccountMarketDividendSettings).toHaveBeenCalledWith("acc-1", "TW");

    await act(async () => {
      (container.querySelector('[data-testid="dividend-settings-edit-acc-1-TW"]') as HTMLButtonElement).click();
    });
    const input = container.querySelector('[data-testid="dividend-settings-par-value-acc-1-TW"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "10.00");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector('[data-testid="dividend-settings-save-acc-1-TW"]') as HTMLButtonElement).click();
    });

    expect(patchAccountMarketDividendSettings).toHaveBeenCalledWith("acc-1", "TW", {
      expectedVersion: 0,
      fallbackParValue: "10.00",
    });
    expect(container.textContent).toContain("TWD 10.00");
    expect(container.textContent).toContain("25 shares per 1,000 eligible shares");
  });

  it("shows a TW default read-only without account-management permission", async () => {
    vi.mocked(fetchAccountMarketDividendSettings).mockResolvedValueOnce(settings({
      version: 2,
      fallbackParValue: "10",
    }));

    await render({ canManage: false });

    expect(container.textContent).toContain("TWD 10");
    expect(container.textContent).toContain("account-management permission is required");
    expect(container.querySelector('[data-testid="dividend-settings-edit-acc-1-TW"]')).toBeNull();
  });

  it("clears an existing TW fallback with optimistic versioning", async () => {
    vi.mocked(fetchAccountMarketDividendSettings).mockResolvedValueOnce(settings({ version: 3, fallbackParValue: "10" }));
    vi.mocked(patchAccountMarketDividendSettings).mockResolvedValueOnce(settings({ version: 4, fallbackParValue: null }));

    await render();
    await act(async () => {
      (container.querySelector('[data-testid="dividend-settings-edit-acc-1-TW"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="dividend-settings-clear-acc-1-TW"]') as HTMLButtonElement).click();
    });

    expect(patchAccountMarketDividendSettings).toHaveBeenCalledWith("acc-1", "TW", {
      expectedVersion: 3,
      fallbackParValue: null,
    });
    expect(container.textContent).toContain("Not configured");
  });

  it("shows non-TW markets as read-only and does not expose edit controls", async () => {
    vi.mocked(fetchAccountMarketDividendSettings).mockResolvedValueOnce(settings({ marketCode: "US" }));

    await render({ marketCode: "US" });

    expect(container.textContent).toContain("not available for this market");
    expect(container.querySelector('[data-testid="dividend-settings-edit-acc-1-US"]')).toBeNull();
  });

  it("focuses a deep-linked section without waiting for settings to load", async () => {
    vi.mocked(fetchAccountMarketDividendSettings).mockReturnValueOnce(new Promise(() => undefined));

    await act(async () => {
      root.render(
        <AccountDividendSettingsSection
          accountId="acc-1"
          marketCode="TW"
          canManage
          dict={dict}
          focused
        />,
      );
    });

    expect(document.activeElement?.getAttribute("data-testid")).toBe("dividend-settings-section-acc-1-TW");
  });

  it("keeps editing available after a save error", async () => {
    vi.mocked(patchAccountMarketDividendSettings).mockRejectedValueOnce(new Error("version conflict"));

    await render();
    await act(async () => {
      (container.querySelector('[data-testid="dividend-settings-edit-acc-1-TW"]') as HTMLButtonElement).click();
    });
    const input = container.querySelector('[data-testid="dividend-settings-par-value-acc-1-TW"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "10");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (container.querySelector('[data-testid="dividend-settings-save-acc-1-TW"]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(container.querySelector('[data-testid="dividend-settings-par-value-acc-1-TW"]')).not.toBeNull();
  });
});
