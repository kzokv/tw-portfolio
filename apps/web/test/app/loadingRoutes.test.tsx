import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { LOCALE_OVERRIDE_COOKIE } from "../../lib/i18n/localeOverrideCookie";
import PortfolioLoading from "../../app/portfolio/loading";
import ReportsLoading from "../../app/reports/loading";
import SettingsLoading from "../../app/settings/loading";
import TransactionsLoading from "../../app/transactions/loading";
import TickerLoading from "../../app/tickers/[ticker]/loading";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { cookies } from "next/headers";

const cookiesMock = vi.mocked(cookies);

function mockLocaleCookie(value?: string) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => name === LOCALE_OVERRIDE_COOKIE && value ? { value } : undefined,
  } as Awaited<ReturnType<typeof cookies>>);
}

async function renderLoading(component: () => Promise<ReactNode>) {
  return renderToStaticMarkup(await component());
}

describe("route loading i18n", () => {
  it("renders zh-TW portfolio loading copy from the route loading dictionary", async () => {
    mockLocaleCookie("zh-TW");

    const html = await renderLoading(PortfolioLoading);

    expect(html).toContain("投資組合");
    expect(html).toContain("載入投資組合工作區中");
    expect(html).toContain("正在準備持股、配置情境，以及以表格為主的檢查畫面。");
  });

  it("renders zh-TW ticker loading copy from the route loading dictionary", async () => {
    mockLocaleCookie("zh-TW");

    const html = await renderLoading(TickerLoading);

    expect(html).toContain("代號");
    expect(html).toContain("載入代號明細中");
    expect(html).toContain("正在準備價格歷史、基本資料，以及你目前的持倉情境。");
  });

  it("falls back to English ticker loading copy when there is no locale cookie", async () => {
    mockLocaleCookie();

    const html = await renderLoading(TickerLoading);

    expect(html).toContain("Tickers");
    expect(html).toContain("Loading ticker detail");
    expect(html).toContain("Preparing price history, fundamentals, and your current position context.");
  });

  it("keeps settings, transactions, and reports loading routes locale-aware", async () => {
    mockLocaleCookie("zh-TW");

    await expect(renderLoading(SettingsLoading)).resolves.toContain("載入設定中");
    await expect(renderLoading(TransactionsLoading)).resolves.toContain("載入交易工作區中");
    await expect(renderLoading(ReportsLoading)).resolves.toContain("載入報表中");
  });
});
