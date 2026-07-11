import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../../lib/api";
import { fetchHoldingActivityDividends } from "../../../../features/portfolio/services/holdingActivityService";

describe("fetchHoldingActivityDividends", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends independent section pages, limits, and account scope", async () => {
    vi.mocked(getJson).mockResolvedValue({} as never);
    const controller = new AbortController();

    await fetchHoldingActivityDividends({
      ticker: "BRK/B",
      marketCode: "US",
      accountId: "acc-1",
      positionActionsPage: 3,
      positionActionsLimit: 25,
      upcomingPage: 1,
      upcomingLimit: 50,
      postedPage: 4,
      postedLimit: 10,
      signal: controller.signal,
    });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/holdings/BRK%2FB/activity-dividends?marketCode=US&positionActionsPage=3&positionActionsLimit=25&upcomingPage=1&upcomingLimit=50&postedPage=4&postedLimit=10&accountId=acc-1",
      { signal: controller.signal },
    );
  });

  it("serializes aggregate account scopes without a singular account", async () => {
    vi.mocked(getJson).mockResolvedValue({} as never);

    await fetchHoldingActivityDividends({
      ticker: "2330",
      marketCode: "TW",
      accountIds: ["acc-1", "acc-2"],
    });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/holdings/2330/activity-dividends?marketCode=TW&positionActionsPage=1&positionActionsLimit=10&upcomingPage=1&upcomingLimit=50&postedPage=1&postedLimit=10&accountIds=acc-1&accountIds=acc-2",
      undefined,
    );
  });
});
