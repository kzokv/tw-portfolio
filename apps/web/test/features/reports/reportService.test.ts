import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../lib/api";
import { fetchReport } from "../../../features/reports/services/reportService";
import { parseReportRouteState } from "../../../features/reports/reportState";

describe("reportService", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({ query: { scope: "all" } });
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("fetches the daily review report endpoint", async () => {
    const state = parseReportRouteState({ tab: "daily-review", scope: "TW", currencyMode: "auto", range: "1Y" });

    await fetchReport("daily-review", state);

    expect(getJson).toHaveBeenCalledWith("/reports/daily-review?scope=TW&currencyMode=auto&limit=25");
  });

  it("fetches the portfolio report endpoint with specified currency", async () => {
    const state = parseReportRouteState({ tab: "portfolio", scope: "all", currencyMode: "specified", currency: "AUD", range: "5Y" });

    await fetchReport("portfolio", state);

    expect(getJson).toHaveBeenCalledWith("/reports/portfolio?scope=all&currencyMode=specified&currency=AUD&range=5Y&limit=25");
  });

  it("passes cancellation options to the report request", async () => {
    const state = parseReportRouteState({ tab: "market", scope: "TW", currencyMode: "auto", range: "1Y" });
    const controller = new AbortController();

    await fetchReport("market", state, { signal: controller.signal });

    expect(getJson).toHaveBeenCalledWith(
      "/reports/market?scope=TW&currencyMode=auto&range=1Y&limit=25",
      { signal: controller.signal },
    );
  });
});
