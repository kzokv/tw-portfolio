import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioPageData } from "../../../../features/portfolio/services/portfolioService";
import { usePortfolioPrimaryData } from "../../../../features/portfolio/hooks/usePortfolioPageData";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  fetchPortfolioEnrichmentData: vi.fn(),
  fetchPortfolioPrimaryData: vi.fn(),
}));

import {
  fetchPortfolioEnrichmentData,
  fetchPortfolioPrimaryData,
} from "../../../../features/portfolio/services/portfolioService";

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
};

function Harness({ initialData = null }: { initialData?: PortfolioPageData | null }) {
  result = usePortfolioPrimaryData(initialData);
  return null;
}

describe("usePortfolioPrimaryData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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
});
