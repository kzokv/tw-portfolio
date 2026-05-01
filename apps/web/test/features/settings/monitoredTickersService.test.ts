import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  putJson: vi.fn(),
}));

import { saveMonitoredTickers } from "../../../features/settings/services/monitoredTickersService";
import { putJson } from "../../../lib/api";

// KZO-169 — Frontend Implementer's TDD red spec for slice 6 (D7a):
// `PUT /monitored-tickers` body shape changed from `{ tickers: [string] }`
// to `{ tickers: [{ ticker, marketCode }] }`.

describe("saveMonitoredTickers — KZO-169 D7a PUT body shape", () => {
  beforeEach(() => {
    vi.mocked(putJson).mockResolvedValue({ tickers: [], newTickers: [] });
  });

  afterEach(() => {
    vi.mocked(putJson).mockReset();
  });

  it("sends `{ tickers: [{ ticker, marketCode }] }` payload to /monitored-tickers", async () => {
    await saveMonitoredTickers([
      { ticker: "2330", marketCode: "TW" },
      { ticker: "BHP", marketCode: "AU" },
      { ticker: "AAPL", marketCode: "US" },
    ]);

    expect(putJson).toHaveBeenCalledWith("/monitored-tickers", {
      tickers: [
        { ticker: "2330", marketCode: "TW" },
        { ticker: "BHP", marketCode: "AU" },
        { ticker: "AAPL", marketCode: "US" },
      ],
    });
  });

  it("sends an empty list payload when no manual selections remain", async () => {
    await saveMonitoredTickers([]);
    expect(putJson).toHaveBeenCalledWith("/monitored-tickers", { tickers: [] });
  });
});
