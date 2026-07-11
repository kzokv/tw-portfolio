import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewHoldingGroupDto, HoldingActivityDividendsDto } from "@vakwen/shared-types";

vi.mock("../../../features/portfolio/services/holdingActivityService", () => ({
  fetchHoldingActivityDividends: vi.fn(),
}));

import { HoldingActivityDetail } from "../../../components/holdings/HoldingActivityDetail";
import { fetchHoldingActivityDividends } from "../../../features/portfolio/services/holdingActivityService";
import { getDictionary } from "../../../lib/i18n";
import { testPriceState } from "../../fixtures/priceState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const row = {
  ticker: "2330",
  marketCode: "TW",
  quantity: 2_000,
  currency: "TWD",
  averageCostPerShare: 600,
  reportingCurrency: "TWD",
  reportingCostBasisAmount: 1_200_000,
  reportingMarketValueAmount: 1_240_000,
  children: [],
  priceState: testPriceState(),
} as unknown as DashboardOverviewHoldingGroupDto;

const response = {
  positionActions: { items: [], page: 2, limit: 25, total: 30 },
  upcomingDividends: {
    page: 1,
    limit: 50,
    total: 1,
    items: [{
      id: "upcoming-1",
      ticker: "2330",
      tickerName: "TSMC",
      accountName: "Main Brokerage",
      exDividendDate: "2026-08-01",
      paymentDate: "2026-08-20",
    }],
  },
  postedDividends: { items: [], page: 3, limit: 10, total: 23 },
} as unknown as HoldingActivityDividendsDto;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe("HoldingActivityDetail", () => {
  it("renders read-only independent pagination and no upcoming pager", async () => {
    vi.mocked(fetchHoldingActivityDividends).mockResolvedValue(response);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<HoldingActivityDetail dict={getDictionary("en")} locale="en" row={row} />);
    });

    expect(fetchHoldingActivityDividends).toHaveBeenCalledWith(expect.objectContaining({
      ticker: "2330",
      marketCode: "TW",
      positionActionsPage: 1,
      positionActionsLimit: 10,
      upcomingPage: 1,
      upcomingLimit: 50,
      postedPage: 1,
      postedLimit: 10,
    }));
    expect(container.textContent).toContain("Holding activity & dividends");
    expect(container.textContent).toContain("TSMC");
    expect(container.querySelector("[data-testid='holding-split-action-panel']")).toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(2);
    expect(container.querySelectorAll("option")).toHaveLength(6);
  });
});
