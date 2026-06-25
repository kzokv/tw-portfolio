import { describe, expect, it } from "vitest";
import { resolveBreadcrumbTitle, resolveExactBreadcrumbTitle } from "../../lib/breadcrumb-titles";

describe("breadcrumb title fallbacks", () => {
  it("keeps longest-prefix page fallback separate from exact segment labels", () => {
    expect(resolveBreadcrumbTitle("/admin/market-data/KR/overview")).toBe("Market Data");
    expect(resolveExactBreadcrumbTitle("/admin/market-data")).toBe("Market Data");
    expect(resolveExactBreadcrumbTitle("/admin/market-data/KR")).toBeNull();
    expect(resolveExactBreadcrumbTitle("/admin/market-data/KR/overview")).toBeNull();
  });

  it("localizes admin and settings fallbacks for zh-TW", () => {
    expect(resolveBreadcrumbTitle("/admin/market-data/KR/overview", { locale: "zh-TW" })).toBe("市場資料");
    expect(resolveExactBreadcrumbTitle("/settings/profile", { locale: "zh-TW" })).toBe("個人資料");
    expect(resolveExactBreadcrumbTitle("/tickers", { locale: "zh-TW" })).toBe("代號");
  });

  it("prefers dictionary-backed labels for shared shell surfaces", () => {
    const dict = {
      commandPalette: { groupTickers: "代號" },
      navigation: {
        dashboardLabel: "儀表板",
        reportsLabel: "報表",
        portfolioLabel: "持倉",
        transactionsLabel: "交易",
        cashLedgerLabel: "現金分類帳",
        dividendsLabel: "股利",
      },
      settings: {
        title: "設定",
        tabProfile: "個人資料",
        tabGeneral: "一般",
        tabAccounts: "帳戶",
        tabDisplay: "顯示",
      },
      sharing: {
        pageTitle: "分享",
      },
    } as NonNullable<Parameters<typeof resolveExactBreadcrumbTitle>[1]>["dict"];

    expect(resolveExactBreadcrumbTitle("/sharing", { dict, locale: "zh-TW" })).toBe("分享");
    expect(resolveExactBreadcrumbTitle("/settings/tickers", { dict, locale: "zh-TW" })).toBe("代號");
  });
});
