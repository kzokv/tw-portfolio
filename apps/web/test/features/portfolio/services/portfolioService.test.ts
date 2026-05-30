import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

import { fetchTransactionInstrumentCatalog } from "../../../../features/portfolio/services/portfolioService";
import { getJson } from "../../../../lib/api";

// KZO-169 — Frontend Implementer's TDD red specs for slice 5 service-layer
// changes (D5c): `?market_code=` is appended for specific markets AND for
// ALL mode (server-side default) so the combobox refetches when the chip
// changes.

describe("fetchTransactionInstrumentCatalog — KZO-169 D5c market_code query", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({ instruments: [] });
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("omits market_code when called with no argument", async () => {
    await fetchTransactionInstrumentCatalog();
    expect(getJson).toHaveBeenCalledWith("/instruments");
  });

  it("appends market_code=TW for the TW chip", async () => {
    await fetchTransactionInstrumentCatalog("TW");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=TW");
  });

  it("appends market_code=US for the US chip", async () => {
    await fetchTransactionInstrumentCatalog("US");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=US");
  });

  it("appends market_code=AU for the AU chip", async () => {
    await fetchTransactionInstrumentCatalog("AU");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=AU");
  });

  it("appends market_code=ALL for the All chip (server returns cross-market catalog)", async () => {
    await fetchTransactionInstrumentCatalog("ALL");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=ALL");
  });

  it("treats null as omit (no market_code)", async () => {
    await fetchTransactionInstrumentCatalog(null);
    expect(getJson).toHaveBeenCalledWith("/instruments");
  });
});
