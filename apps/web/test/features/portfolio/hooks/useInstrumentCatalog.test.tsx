import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InstrumentCatalogItemDto } from "@tw-portfolio/shared-types";
import {
  filterInstrumentCatalog,
  useInstrumentCatalog,
  type TransactionInstrumentOption,
} from "../../../../features/portfolio/hooks/useInstrumentCatalog";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionInstrumentCatalog: vi.fn(),
}));

import { fetchTransactionInstrumentCatalog } from "../../../../features/portfolio/services/portfolioService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useInstrumentCatalog>;

function Harness() {
  result = useInstrumentCatalog();
  return null;
}

describe("useInstrumentCatalog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchTransactionInstrumentCatalog).mockReset();
  });

  it("filters null instrument types from the fetched catalog", async () => {
    vi.mocked(fetchTransactionInstrumentCatalog).mockResolvedValue({
      instruments: [
        { ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
        { ticker: "020000", name: "ETN", instrumentType: null, marketCode: "TW", barsBackfillStatus: "pending" },
      ] satisfies InstrumentCatalogItemDto[],
    });

    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    expect(result.catalog.map((instrument) => instrument.ticker)).toEqual(["2330"]);
    expect(result.isLoading).toBe(false);
    expect(result.error).toBe("");
  });
});

describe("filterInstrumentCatalog", () => {
  const catalog: TransactionInstrumentOption[] = [
    { ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
    { ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
    { ticker: "0050", name: "Yuanta Taiwan 50 ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  ];

  it("matches by ticker and name case-insensitively", () => {
    expect(filterInstrumentCatalog(catalog, "233").items.map((instrument) => instrument.ticker)).toEqual(["2330"]);
    expect(filterInstrumentCatalog(catalog, "hon hai").items.map((instrument) => instrument.ticker)).toEqual(["2317"]);
  });

  it("caps visible results at twenty items", () => {
    const largeCatalog = Array.from({ length: 25 }, (_, index) => ({
      ticker: String(index).padStart(4, "0"),
      name: `Instrument ${index}`,
      instrumentType: "ETF" as const,
      marketCode: "TW",
      barsBackfillStatus: "pending",
    }));

    const filtered = filterInstrumentCatalog(largeCatalog, "");
    expect(filtered.total).toBe(25);
    expect(filtered.items).toHaveLength(20);
  });
});
