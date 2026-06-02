import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useMonitoredTickers } from "../../../../features/settings/hooks/useMonitoredTickers";

vi.mock("../../../../hooks/useEventStream", () => ({
  useEventStream: vi.fn(),
}));

vi.mock("../../../../features/settings/services/monitoredTickersService", () => ({
  fetchMonitoredTickers: vi.fn(),
  fetchInstrumentsCatalog: vi.fn(),
  retryBackfill: vi.fn(),
  saveMonitoredTickers: vi.fn(),
}));

vi.mock("../../../../features/settings/services/repairService", () => ({
  requestRepair: vi.fn(),
}));

import {
  fetchInstrumentsCatalog,
  fetchMonitoredTickers,
} from "../../../../features/settings/services/monitoredTickersService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useMonitoredTickers>;

function Harness() {
  result = useMonitoredTickers(true);
  return null;
}

describe("useMonitoredTickers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchMonitoredTickers).mockResolvedValue({
      tickers: [
        {
          ticker: "2330",
          marketCode: "TW",
          source: "manual",
          name: "TSMC",
          barsBackfillStatus: "ready",
        },
      ],
    } as never);
    vi.mocked(fetchInstrumentsCatalog).mockResolvedValue({
      instruments: [
        {
          ticker: "2330",
          marketCode: "TW",
          name: "TSMC",
          instrumentType: "STOCK",
          barsBackfillStatus: "ready",
          lastRepairAt: null,
          repairAvailableAt: null,
          sector: null,
          gicsIndustryGroup: null,
        },
      ],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchMonitoredTickers).mockReset();
    vi.mocked(fetchInstrumentsCatalog).mockReset();
  });

  it("loads monitored tickers before the full catalog", async () => {
    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    expect(fetchMonitoredTickers).toHaveBeenCalledTimes(1);
    expect(fetchInstrumentsCatalog).not.toHaveBeenCalled();
    expect(result.monitoredTickers[0]?.ticker).toBe("2330");
  });

  it("loads the full catalog only after the catalog view is opened", async () => {
    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    await act(async () => {
      result.setShowCatalog(true);
    });

    await act(async () => {});

    expect(fetchInstrumentsCatalog).toHaveBeenCalledTimes(1);
    expect(result.isCatalogLoading).toBe(false);
    expect(result.instruments[0]?.ticker).toBe("2330");
  });

  it("surfaces catalog load errors after the catalog view is opened", async () => {
    vi.mocked(fetchInstrumentsCatalog).mockRejectedValue(new Error("catalog unavailable"));

    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    await act(async () => {
      result.setShowCatalog(true);
    });

    await act(async () => {});

    expect(fetchInstrumentsCatalog).toHaveBeenCalledTimes(1);
    expect(result.isCatalogLoading).toBe(false);
    expect(result.catalogError).toBe("catalog unavailable");
  });
});
