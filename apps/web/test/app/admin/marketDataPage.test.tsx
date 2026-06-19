import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../components/admin/AdminMarketDataClient", () => ({
  AdminMarketDataLandingClient: (props: Record<string, unknown>) => (
    <div data-testid="admin-market-data-landing" data-props={JSON.stringify(props)} />
  ),
  AdminMarketDataWorkspaceClient: (props: Record<string, unknown>) => (
    <div data-testid="admin-market-data-workspace" data-props={JSON.stringify(props)} />
  ),
}));

import { getJson } from "../../../lib/api";
import AdminMarketDataPage from "../../../app/admin/market-data/page";
import AdminMarketDataWorkspacePage from "../../../app/admin/market-data/[marketCode]/[tab]/page";

const getJsonMock = vi.mocked(getJson);

describe("AdminMarketDataPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("fetches the market-data landing BFF", async () => {
    getJsonMock.mockResolvedValueOnce({
      markets: [{ marketCode: "AU", label: "Australia", providers: [] }],
    });

    const element = await AdminMarketDataPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("admin-market-data-landing");
    expect(getJsonMock).toHaveBeenCalledWith("/admin/market-data");
  });

  it("fetches market workspace instruments from the canonical route", async () => {
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/admin/market-data/AU/overview") {
        return { marketCode: "AU", label: "Australia", tabs: ["overview", "instruments"], providers: [] };
      }
      if (path === "/admin/market-data/AU/actions") {
        return { marketCode: "AU", actions: [] };
      }
      if (path === "/admin/market-data/AU/instruments?page=3&limit=25&status=listed&supportState=supported&instrumentType=ETF&backfillStatus=failed&sort=updated_desc&search=BHP") {
        return { marketCode: "AU", items: [], total: 0, page: 3, limit: 25, thresholds: {}, filters: {} };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }) as never);

    const element = await AdminMarketDataWorkspacePage({
      params: Promise.resolve({ marketCode: "AU", tab: "instruments" }),
      searchParams: Promise.resolve({
        page: "3",
        limit: "25",
        status: "listed",
        supportState: "supported",
        search: "BHP",
        instrumentType: "ETF",
        backfillStatus: "failed",
        sort: "updated_desc",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("admin-market-data-workspace");
    expect(getJsonMock.mock.calls.map(([path]) => path)).toEqual([
      "/admin/market-data/AU/overview",
      "/admin/market-data/AU/actions",
      "/admin/market-data/AU/instruments?page=3&limit=25&status=listed&supportState=supported&instrumentType=ETF&backfillStatus=failed&sort=updated_desc&search=BHP",
    ]);
  });

  it("fetches market activity with canonical activity filters", async () => {
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/admin/market-data/KR/overview") {
        return { marketCode: "KR", label: "Korea", tabs: ["overview", "operations"], providers: [] };
      }
      if (path === "/admin/market-data/KR/actions") {
        return { marketCode: "KR", actions: [] };
      }
      if (path === "/admin/market-data/KR/activity?page=2&limit=10&search=2330&sourceKind=yahoo_chart&category=intraday_price&timeRange=24h") {
        return { marketCode: "KR", providers: [], summary: [], items: [], total: 0, page: 2, limit: 10 };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }) as never);

    await AdminMarketDataWorkspacePage({
      params: Promise.resolve({ marketCode: "KR", tab: "activity" }),
      searchParams: Promise.resolve({
        page: "2",
        limit: "10",
        search: "2330",
        source: "yahoo_chart",
        category: "intraday_price",
      }),
    });

    expect(getJsonMock.mock.calls.map(([path]) => path)).toEqual([
      "/admin/market-data/KR/overview",
      "/admin/market-data/KR/actions",
      "/admin/market-data/KR/activity?page=2&limit=10&search=2330&sourceKind=yahoo_chart&category=intraday_price&timeRange=24h",
    ]);
  });

  it("defaults activity filters to all results over the last 24 hours", async () => {
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/admin/market-data/AU/overview") {
        return { marketCode: "AU", label: "Australia", tabs: ["overview", "activity"], providers: [] };
      }
      if (path === "/admin/market-data/AU/actions") {
        return { marketCode: "AU", actions: [] };
      }
      if (path === "/admin/market-data/AU/activity?page=1&limit=25&timeRange=24h") {
        return { marketCode: "AU", providers: [], summary: [], items: [], total: 0, page: 1, limit: 25 };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }) as never);

    await AdminMarketDataWorkspacePage({
      params: Promise.resolve({ marketCode: "AU", tab: "activity" }),
      searchParams: Promise.resolve({}),
    });

    expect(getJsonMock.mock.calls.map(([path]) => path)).toEqual([
      "/admin/market-data/AU/overview",
      "/admin/market-data/AU/actions",
      "/admin/market-data/AU/activity?page=1&limit=25&timeRange=24h",
    ]);
  });

  it("rejects the legacy logs tab once activity replaces it", async () => {
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/admin/market-data/KR/overview") {
        return { marketCode: "KR", label: "Korea", tabs: ["overview", "operations", "activity"], providers: [] };
      }
      if (path === "/admin/market-data/KR/actions") {
        return { marketCode: "KR", actions: [] };
      }
      if (path === "/admin/market-data/KR/logs?page=1&limit=50") {
        return { marketCode: "KR", providers: [], items: [], total: 0, page: 1, limit: 50 };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }) as never);

    await expect(AdminMarketDataWorkspacePage({
      params: Promise.resolve({ marketCode: "KR", tab: "logs" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("notFound");
  });
});
