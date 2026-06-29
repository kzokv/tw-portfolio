import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "./i18n/types";

interface BreadcrumbFallbackEntry {
  pathname: string;
  label: string;
}

interface BreadcrumbResolverOptions {
  dict?: Pick<AppDictionary, "analysis" | "commandPalette" | "navigation" | "settings" | "sharing">;
  locale?: LocaleCode | null;
}

const STATIC_FALLBACKS: Record<"en" | "zh-TW", ReadonlyArray<BreadcrumbFallbackEntry>> = {
  en: [
    { pathname: "/admin/users", label: "Users" },
    { pathname: "/admin/invites", label: "Invites" },
    { pathname: "/admin/audit-log", label: "Audit Log" },
    { pathname: "/admin/market-data", label: "Market Data" },
    { pathname: "/admin/settings", label: "Settings" },
    { pathname: "/admin", label: "Admin" },
    { pathname: "/settings/profile", label: "Profile" },
    { pathname: "/settings/general", label: "General" },
    { pathname: "/settings/accounts", label: "Accounts" },
    { pathname: "/settings/display", label: "Display" },
    { pathname: "/settings/tickers", label: "Tickers" },
    { pathname: "/settings/notifications", label: "Notifications" },
    { pathname: "/settings/privacy", label: "Privacy" },
    { pathname: "/settings", label: "Settings" },
    { pathname: "/dashboard", label: "Dashboard" },
    { pathname: "/analysis/unrealized-pnl", label: "Unrealized P&L" },
    { pathname: "/analysis", label: "Analysis" },
    { pathname: "/reports", label: "Reports" },
    { pathname: "/portfolio", label: "Portfolio" },
    { pathname: "/transactions", label: "Transactions" },
    { pathname: "/cash-ledger", label: "Cash Ledger" },
    { pathname: "/dividends", label: "Dividends" },
    { pathname: "/sharing", label: "Sharing" },
    { pathname: "/tickers", label: "Tickers" },
  ],
  "zh-TW": [
    { pathname: "/admin/users", label: "使用者" },
    { pathname: "/admin/invites", label: "邀請" },
    { pathname: "/admin/audit-log", label: "稽核記錄" },
    { pathname: "/admin/market-data", label: "市場資料" },
    { pathname: "/admin/settings", label: "設定" },
    { pathname: "/admin", label: "管理" },
    { pathname: "/settings/profile", label: "個人資料" },
    { pathname: "/settings/general", label: "一般" },
    { pathname: "/settings/accounts", label: "帳戶" },
    { pathname: "/settings/display", label: "顯示" },
    { pathname: "/settings/tickers", label: "代號" },
    { pathname: "/settings/notifications", label: "通知" },
    { pathname: "/settings/privacy", label: "隱私" },
    { pathname: "/settings", label: "設定" },
    { pathname: "/dashboard", label: "儀表板" },
    { pathname: "/analysis/unrealized-pnl", label: "未實現損益" },
    { pathname: "/analysis", label: "分析" },
    { pathname: "/reports", label: "報表" },
    { pathname: "/portfolio", label: "持倉" },
    { pathname: "/transactions", label: "交易" },
    { pathname: "/cash-ledger", label: "現金分類帳" },
    { pathname: "/dividends", label: "股利" },
    { pathname: "/sharing", label: "分享" },
    { pathname: "/tickers", label: "代號" },
  ],
};

function normalizeLocale(locale?: LocaleCode | null): "en" | "zh-TW" {
  return locale === "zh-TW" ? "zh-TW" : "en";
}

function dictionaryLabel(
  pathname: string,
  dict: BreadcrumbResolverOptions["dict"],
): string | null {
  if (!dict) return null;
  if (pathname === "/dashboard") return dict.commandPalette.routeDashboard;
  if (pathname === "/analysis") return dict.commandPalette.routeAnalysis;
  if (pathname === "/analysis/unrealized-pnl") return dict.analysis.breadcrumbDetail;
  if (pathname === "/reports") return dict.commandPalette.routeReports;
  if (pathname === "/portfolio") return dict.commandPalette.routePortfolio;
  if (pathname === "/transactions") return dict.commandPalette.routeTransactions;
  if (pathname === "/cash-ledger") return dict.commandPalette.routeCashLedger;
  if (pathname === "/dividends") return dict.commandPalette.routeDividends;
  if (pathname === "/sharing") return dict.sharing.pageTitle;
  if (pathname === "/tickers") return dict.commandPalette.groupTickers;
  if (pathname === "/settings") return dict.settings.title;
  if (pathname === "/settings/profile") return dict.settings.tabProfile;
  if (pathname === "/settings/general") return dict.settings.tabGeneral;
  if (pathname === "/settings/accounts") return dict.settings.tabAccounts;
  if (pathname === "/settings/display") return dict.settings.tabDisplay;
  if (pathname === "/settings/tickers") return dict.commandPalette.groupTickers;
  if (pathname === "/admin/settings") return dict.settings.title;
  return null;
}

function findStaticMatch(
  pathname: string,
  locale: "en" | "zh-TW",
  exactOnly: boolean,
): string | null {
  const entries = STATIC_FALLBACKS[locale];
  for (const entry of entries) {
    if (pathname === entry.pathname) return entry.label;
    if (!exactOnly && pathname.startsWith(`${entry.pathname}/`)) return entry.label;
  }
  return null;
}

export function resolveBreadcrumbTitle(pathname: string, options: BreadcrumbResolverOptions = {}): string | null {
  const fromDict = dictionaryLabel(pathname, options.dict);
  if (fromDict) return fromDict;
  return findStaticMatch(pathname, normalizeLocale(options.locale), false);
}

export function resolveExactBreadcrumbTitle(pathname: string, options: BreadcrumbResolverOptions = {}): string | null {
  const fromDict = dictionaryLabel(pathname, options.dict);
  if (fromDict) return fromDict;
  return findStaticMatch(pathname, normalizeLocale(options.locale), true);
}

export const __BREADCRUMB_FALLBACK_MAP = STATIC_FALLBACKS;
