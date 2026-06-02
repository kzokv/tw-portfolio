import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useShellPortfolioConfig } from "../../../components/layout/useShellPortfolioConfig";
import type { ShellPortfolioConfigDto } from "../../../features/settings/services/shellPortfolioConfigService";
import type { TransactionInput } from "../../../components/portfolio/types";

vi.mock("../../../features/settings/services/shellPortfolioConfigService", () => ({
  fetchShellPortfolioConfig: vi.fn(),
}));

import { fetchShellPortfolioConfig } from "../../../features/settings/services/shellPortfolioConfigService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const initialTransaction: TransactionInput = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-06-02",
  type: "BUY",
  isDayTrade: false,
};

const loadedConfig: ShellPortfolioConfigDto = {
  accounts: [{
    id: "account-1",
    name: "Brokerage",
    userId: "user-1",
    feeProfileId: "fee-1",
    defaultCurrency: "TWD",
    accountType: "broker",
  }],
  feeProfiles: [{
    id: "fee-1",
    accountId: "account-1",
    name: "Standard",
    boardCommissionRate: 0.001425,
    commissionDiscountPercent: 60,
    minimumCommissionAmount: 20,
    commissionCurrency: "TWD",
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 10,
    commissionChargeMode: "CHARGED_UPFRONT",
  }],
  feeProfileBindings: [],
  integrityIssue: null,
};

let result: ReturnType<typeof useShellPortfolioConfig>;

function Harness({ fetchMode = "lazy" }: { fetchMode?: "eager" | "lazy" }) {
  result = useShellPortfolioConfig({
    initialTransaction,
    initialConfig: null,
    fetchMode,
  });
  return null;
}

describe("useShellPortfolioConfig", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchShellPortfolioConfig).mockResolvedValue(loadedConfig);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchShellPortfolioConfig).mockReset();
  });

  it("defers lazy shell config until config-dependent actions request it", async () => {
    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    await act(async () => {});

    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
    expect(result.accounts).toEqual([]);
    expect(result.isLoading).toBe(false);

    await act(async () => {
      await result.ensureLoaded();
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts).toEqual(loadedConfig.accounts);
    expect(result.feeProfiles).toEqual(loadedConfig.feeProfiles);
    expect(result.isLoading).toBe(false);
  });

  it("deduplicates concurrent lazy config loads", async () => {
    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    await act(async () => {
      await Promise.all([result.ensureLoaded(), result.ensureLoaded()]);
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts[0]?.id).toBe("account-1");
  });
});
