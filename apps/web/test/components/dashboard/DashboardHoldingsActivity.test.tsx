import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewHoldingDto } from "@vakwen/shared-types";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

vi.mock("../../../components/holdings/HoldingActivityDetail", () => ({
  HoldingActivityDetail: ({ row }: { row: { ticker: string; accountId?: string } }) => (
    <div data-testid="mock-holding-activity-detail">{row.ticker}:{row.accountId ?? "all"}</div>
  ),
}));

import { DashboardHoldingsPreview } from "../../../components/dashboard/DashboardHoldingsPreview";
import { buildHoldingGroupsFromHoldings } from "../../../features/portfolio/holdingGroups";
import { testPriceState } from "../../fixtures/priceState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const holding: DashboardOverviewHoldingDto = {
  accountId: "acc-1",
  accountName: "Main Brokerage",
  ticker: "2330",
  instrumentName: "TSMC",
  marketCode: "TW",
  quantity: 10,
  costBasisAmount: 6_000,
  currency: "TWD",
  averageCostPerShare: 600,
  currentUnitPrice: 620,
  marketValueAmount: 6_200,
  unrealizedPnlAmount: 200,
  allocationPct: 100,
  change: 5,
  changePercent: 0.82,
  previousClose: 615,
  quoteStatus: "current",
  nextDividendDate: null,
  lastDividendPostedDate: null,
  priceState: testPriceState(),
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe("DashboardHoldingsPreview holding activity quick links", () => {
  it("exposes an accessible icon link and opens the shared read-only surface", async () => {
    const group = buildHoldingGroupsFromHoldings({ holdings: [holding] })[0]!;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DashboardHoldingsPreview groups={[group]} locale="en" reportingCurrency="TWD" />,
      );
    });

    const quickLink = container.querySelector<HTMLButtonElement>(
      "[data-testid='dashboard-holding-table-open-activity-2330-TW']",
    );
    expect(quickLink?.getAttribute("aria-label")).toBe("Holding activity & dividends: 2330");
    expect(quickLink?.getAttribute("title")).toBe("Holding activity & dividends: 2330");

    await act(async () => {
      quickLink?.click();
    });

    expect(document.body.querySelector("[data-testid='mock-holding-activity-detail']")?.textContent).toBe("2330:all");
  });
});
