import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../features/dividends/services/dividendCalculationService", async () => {
  const actual = await vi.importActual<typeof import("../../../features/dividends/services/dividendCalculationService")>(
    "../../../features/dividends/services/dividendCalculationService",
  );
  return {
    ...actual,
    fetchAccountMarketDividendSettings: vi.fn(),
    previewDividendCalculation: vi.fn(),
    confirmDividendCalculation: vi.fn(),
    amendDividendCalculation: vi.fn(),
    resetDividendCalculation: vi.fn(),
  };
});

import {
  fetchAccountMarketDividendSettings,
  confirmDividendCalculation,
  resetDividendCalculation,
  previewDividendCalculation,
} from "../../../features/dividends/services/dividendCalculationService";
import { DividendCalculationPanel } from "../../../features/dividends/components/DividendCalculationPanel";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

describe("DividendCalculationPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchAccountMarketDividendSettings).mockResolvedValue({
      accountId: "acc-1",
      marketCode: "TW",
      version: 1,
      fallbackParValue: "10",
      updatedAt: "2026-07-17T04:00:00.000Z",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("previews a par-value calculation with provenance and entitlement details", async () => {
    const activeCalculation = {
      id: "calc-2",
      accountId: "acc-1",
      dividendEventId: "event-1",
      calculationVersion: 2,
      status: "amended" as const,
      method: "derived_from_par_value" as const,
      provider: { value: "12.5", unit: "TWD_PER_SHARE" as const, source: "finmind", dataset: "TaiwanStockDividend", authoritativeRatio: "1.25" },
      ratio: "1.25",
      selectedParValue: "10",
      theoreticalShares: "1250.25",
      expectedWholeShares: 1250,
      fractionalRemainder: "0.25",
      requiresHighRatioConfirmation: true,
      confirmedAt: "2026-07-17T04:00:00.000Z",
      supersededAt: null,
      priorCalculationId: "calc-1",
      dividendLedgerEntryId: "ledger-1",
      drift: null,
    };
    vi.mocked(confirmDividendCalculation).mockResolvedValue(activeCalculation);
    vi.mocked(previewDividendCalculation).mockResolvedValue({
      accountId: "acc-1",
      dividendEventId: "event-1",
      marketCode: "TW",
      eligibleQuantity: 1_000,
      method: "derived_from_par_value",
      providerValue: "12.5",
      providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind",
      providerDataset: "TaiwanStockDividend",
      providerAuthoritativeRatio: "1.25",
      ratio: "1.25",
      selectedParValue: "10",
      theoreticalShares: "1250.25",
      expectedWholeShares: 1_250,
      fractionalRemainder: "0.25",
      requiresHighRatioConfirmation: true,
      drift: {
        hasDrift: true,
        previousProviderValue: "2.5",
        previousProviderUnit: "TWD_PER_SHARE",
        currentProviderValue: "12.5",
        currentProviderUnit: "TWD_PER_SHARE",
        previousAuthoritativeRatio: "0.25",
        currentAuthoritativeRatio: "1.25",
      },
      activeCalculation,
    });

    await act(async () => {
      root.render(
        <DividendCalculationPanel
          accountId="acc-1"
          dividendEventId="event-1"
          marketCode="TW"
          initialMethod="derived_from_par_value"
          canManageAccountDefaults
          calculationHistory={[
            activeCalculation,
            { ...activeCalculation, id: "calc-1", calculationVersion: 1, status: "confirmed", priorCalculationId: null },
          ]}
          dict={dict}
          locale="en"
        />,
      );
    });

    const parValue = container.querySelector('[data-testid="dividend-calculation-par-value"]') as HTMLInputElement;
    expect(parValue.value).toBe("10");

    await act(async () => {
      (container.querySelector('[data-testid="dividend-calculation-preview"]') as HTMLButtonElement).click();
    });

    expect(previewDividendCalculation).toHaveBeenCalledWith({
      accountId: "acc-1",
      dividendEventId: "event-1",
      method: "derived_from_par_value",
      selectedParValue: "10",
    });
    expect(container.textContent).toContain("finmind");
    expect(container.textContent).toContain("TaiwanStockDividend");
    expect(container.textContent).toContain("1,250");
    expect(container.textContent).toContain("0.25");
    expect(container.querySelector('[data-testid="dividend-calculation-high-ratio-warning"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dividend-calculation-drift"]')?.textContent).toContain("2.5");
    expect(container.querySelector('[data-testid="dividend-calculation-drift"]')?.textContent).toContain("12.5");
    expect(container.querySelector('[data-testid="dividend-calculation-history"]')?.textContent).toContain("amended");
    expect(container.querySelector('[data-testid="dividend-calculation-history"]')?.textContent).toContain("calc-1");
    expect(container.querySelectorAll('[data-testid^="dividend-calculation-history-version-"]')).toHaveLength(2);

    const confirm = container.querySelector('[data-testid="dividend-calculation-confirm"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      (container.querySelector('[data-testid="dividend-calculation-ack-high-ratio"]') as HTMLInputElement).click();
      (container.querySelector('[data-testid="dividend-calculation-ack-drift"]') as HTMLInputElement).click();
    });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(confirmDividendCalculation).toHaveBeenCalledWith({
      accountId: "acc-1",
      dividendEventId: "event-1",
      method: "derived_from_par_value",
      selectedParValue: "10",
      expectedActiveCalculationId: "calc-2",
      expectedCalculationVersion: 2,
      acknowledgeHighRatio: true,
      acknowledgeDrift: true,
    });
    expect(confirmDividendCalculation).toHaveBeenCalledTimes(1);

    const settingsLink = container.querySelector('[data-testid="dividend-calculation-settings-link"]') as HTMLAnchorElement;
    expect(settingsLink.getAttribute("href")).toBe(
      "/settings/accounts?accountId=acc-1&marketCode=TW&section=dividend-calculation-defaults",
    );
    expect(settingsLink.target).toBe("_blank");
  });

  it("resets an existing calculation without requiring a new preview", async () => {
    vi.mocked(resetDividendCalculation).mockResolvedValue({ status: "ok" });
    const activeCalculation = {
      id: "calc-1", accountId: "acc-1", dividendEventId: "event-1", calculationVersion: 1,
      status: "confirmed" as const, method: "provider_ratio" as const,
      provider: { value: "0.1", unit: "RATIO" as const, source: "finmind", dataset: "TaiwanStockDividend", authoritativeRatio: "0.1" },
      ratio: "0.1", selectedParValue: null, theoreticalShares: "100", expectedWholeShares: 100,
      fractionalRemainder: "0", requiresHighRatioConfirmation: false,
      confirmedAt: "2026-07-17T04:00:00.000Z", supersededAt: null, priorCalculationId: null,
      dividendLedgerEntryId: null, drift: null,
    };
    await act(async () => {
      root.render(
        <DividendCalculationPanel accountId="acc-1" dividendEventId="event-1" marketCode="TW" initialMethod="provider_ratio" canManageAccountDefaults activeCalculation={activeCalculation} dict={dict} locale="en" />,
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="dividend-calculation-reset"]') as HTMLButtonElement).click();
    });

    expect(resetDividendCalculation).toHaveBeenCalledWith({
      accountId: "acc-1",
      dividendEventId: "event-1",
      expectedActiveCalculationId: "calc-1",
      expectedCalculationVersion: 1,
    });
    expect(container.querySelector('[data-testid="dividend-calculation-history"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dividend-calculation-reset"]')).toBeNull();
  });

  it("invalidates a preview when a clean settings value changes after focus", async () => {
    vi.mocked(fetchAccountMarketDividendSettings)
      .mockResolvedValueOnce({
        accountId: "acc-1", marketCode: "TW", version: 1, fallbackParValue: "10", updatedAt: null,
      })
      .mockResolvedValueOnce({
        accountId: "acc-1", marketCode: "TW", version: 2, fallbackParValue: "20", updatedAt: null,
      });
    vi.mocked(previewDividendCalculation).mockResolvedValue({
      accountId: "acc-1", dividendEventId: "event-1", marketCode: "TW", eligibleQuantity: 1_000,
      method: "derived_from_par_value", providerValue: "1.5", providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind", providerDataset: "TaiwanStockDividend", providerAuthoritativeRatio: null,
      ratio: "0.15", selectedParValue: "10", theoreticalShares: "150", expectedWholeShares: 150,
      fractionalRemainder: "0", requiresHighRatioConfirmation: false, drift: null, activeCalculation: null,
    });
    await act(async () => {
      root.render(
        <DividendCalculationPanel accountId="acc-1" dividendEventId="event-1" marketCode="TW" initialMethod="derived_from_par_value" canManageAccountDefaults dict={dict} locale="en" />,
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="dividend-calculation-preview"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="dividend-calculation-result"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect((container.querySelector('[data-testid="dividend-calculation-par-value"]') as HTMLInputElement).value).toBe("20");
    expect(container.querySelector('[data-testid="dividend-calculation-result"]')).toBeNull();
  });

  it("shows provider provenance without mutation controls in read-only mode", async () => {
    await act(async () => {
      root.render(
        <DividendCalculationPanel
          accountId="acc-1"
          dividendEventId="event-1"
          marketCode="TW"
          initialMethod="provider_ratio"
          canManageAccountDefaults={false}
          canWriteCalculations={false}
          dividendLedgerEntryId="ledger-1"
          initialProvider={{
            value: "0.15",
            unit: "RATIO",
            source: "finmind",
            dataset: "TaiwanStockDividend",
            authoritativeRatio: "0.15",
          }}
          dict={dict}
          locale="en"
        />,
      );
    });

    expect(container.querySelector('[data-testid="dividend-calculation-provider"]')?.textContent).toContain("finmind");
    expect(container.querySelector('[data-testid="dividend-calculation-provider"]')?.textContent).toContain("TaiwanStockDividend");
    expect((container.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
    expect(container.querySelector('[data-testid="dividend-calculation-preview"]')).toBeNull();
    expect(container.querySelector('[data-testid="dividend-calculation-reset"]')).toBeNull();
  });

  it("does not offer reset for a calculation attached to a posted ledger entry", async () => {
    const activeCalculation = {
      id: "calc-1", accountId: "acc-1", dividendEventId: "event-1", calculationVersion: 1,
      status: "confirmed" as const, method: "provider_ratio" as const,
      provider: { value: "0.1", unit: "RATIO" as const, source: "finmind", dataset: "TaiwanStockDividend", authoritativeRatio: "0.1" },
      ratio: "0.1", selectedParValue: null, theoreticalShares: "100", expectedWholeShares: 100,
      fractionalRemainder: "0", requiresHighRatioConfirmation: false,
      confirmedAt: "2026-07-17T04:00:00.000Z", supersededAt: null, priorCalculationId: null,
      dividendLedgerEntryId: "ledger-1", drift: null,
    };
    await act(async () => {
      root.render(
        <DividendCalculationPanel accountId="acc-1" dividendEventId="event-1" marketCode="TW" initialMethod="provider_ratio" canManageAccountDefaults dividendLedgerEntryId="ledger-1" activeCalculation={activeCalculation} dict={dict} locale="en" />,
      );
    });

    expect(container.querySelector('[data-testid="dividend-calculation-reset"]')).toBeNull();
  });
});
