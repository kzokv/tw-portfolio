import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioPageData } from "../../../../features/portfolio/services/portfolioService";
import { usePortfolioPrimaryData } from "../../../../features/portfolio/hooks/usePortfolioPageData";
import { buildRouteDtoCacheKey, writeRouteDtoCache } from "../../../../lib/routeDtoCache";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  fetchPortfolioEnrichmentData: vi.fn(),
  fetchPortfolioPrimaryData: vi.fn(),
}));

import {
  fetchPortfolioEnrichmentData,
  fetchPortfolioPrimaryData,
} from "../../../../features/portfolio/services/portfolioService";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof usePortfolioPrimaryData>;

const initialPrimaryData: PortfolioPageData = {
  holdings: [],
  holdingGroups: [],
  dividends: { upcoming: [], recent: [] },
  instruments: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

function pageDataWithAccount(id: string): PortfolioPageData {
  return {
    ...initialPrimaryData,
    accounts: [{
      id,
      name: id,
      userId: "user-1",
      feeProfileId: "fee-1",
      defaultCurrency: "TWD",
      accountType: "broker",
    }],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Harness({ initialData = null }: { initialData?: PortfolioPageData | null }) {
  result = usePortfolioPrimaryData(initialData, buildRouteDtoCacheKey("portfolio-primary", "self"));
  return null;
}

describe("usePortfolioPrimaryData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installLocalStorageMock();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    vi.mocked(fetchPortfolioEnrichmentData).mockResolvedValue(initialPrimaryData);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchPortfolioEnrichmentData).mockReset();
    vi.mocked(fetchPortfolioPrimaryData).mockReset();
  });

  it("hydrates immediately from server-provided initial primary data", async () => {
    act(() => {
      root.render(<Harness initialData={initialPrimaryData} />);
    });

    await act(async () => {});

    expect(result.isBootstrapping).toBe(false);
    expect(fetchPortfolioPrimaryData).not.toHaveBeenCalled();
    expect(fetchPortfolioEnrichmentData).toHaveBeenCalledTimes(1);
  });

  it("fetches primary data when no initial payload is provided", async () => {
    vi.mocked(fetchPortfolioPrimaryData).mockResolvedValue(initialPrimaryData);

    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    expect(fetchPortfolioPrimaryData).toHaveBeenCalledTimes(1);
    expect(fetchPortfolioEnrichmentData).toHaveBeenCalledTimes(1);
    expect(result.isBootstrapping).toBe(false);
  });

  it("restores cached portfolio data before refreshing in the background", async () => {
    const cached = pageDataWithAccount("cached");
    const refreshed = pageDataWithAccount("fresh");
    writeRouteDtoCache(buildRouteDtoCacheKey("portfolio-primary", "self"), cached);
    vi.mocked(fetchPortfolioPrimaryData).mockResolvedValue(refreshed);
    vi.mocked(fetchPortfolioEnrichmentData).mockResolvedValue(refreshed);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.data.accounts[0]?.id).toBe("cached");
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {});

    expect(fetchPortfolioPrimaryData).toHaveBeenCalledTimes(1);
    expect(result.data.accounts[0]?.id).toBe("fresh");
  });

  it("ignores stale enrichment responses after a newer refresh starts", async () => {
    const staleEnrichment = createDeferred<PortfolioPageData>();
    const latestEnrichment = createDeferred<PortfolioPageData>();
    const refreshedPrimary = pageDataWithAccount("latest-primary");
    const staleSnapshot = pageDataWithAccount("stale-enrichment");
    const latestSnapshot = pageDataWithAccount("latest-enrichment");
    vi.mocked(fetchPortfolioPrimaryData).mockResolvedValue(refreshedPrimary);
    vi.mocked(fetchPortfolioEnrichmentData)
      .mockReturnValueOnce(staleEnrichment.promise)
      .mockReturnValueOnce(latestEnrichment.promise);

    act(() => {
      root.render(<Harness initialData={initialPrimaryData} />);
    });

    await act(async () => {});

    expect(fetchPortfolioEnrichmentData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.refresh();
    });

    expect(fetchPortfolioEnrichmentData).toHaveBeenCalledTimes(2);
    expect(result.data.accounts[0]?.id).toBe("latest-primary");

    await act(async () => {
      staleEnrichment.resolve(staleSnapshot);
      await staleEnrichment.promise;
    });

    expect(result.data.accounts[0]?.id).toBe("latest-primary");

    await act(async () => {
      latestEnrichment.resolve(latestSnapshot);
      await latestEnrichment.promise;
    });

    expect(result.data.accounts[0]?.id).toBe("latest-enrichment");
  });
});
