import type { AppDictionary } from "../../lib/i18n/types";
import type { LocaleCode } from "@vakwen/shared-types";

/**
 * Layout/chrome i18n — strings that belong to the outer shell (TopBar, sidebar,
 * portfolio switcher, ⌘K command palette) rather than any feature slice.
 *
 * Placeholders use `{token}` template form (per nextjs-i18n-serialization.md):
 *   - `ownerOptionLabel` interpolates `{owner}` at call site.
 *   - `commandPalette.actionAccentPrefix` interpolates `{accent}` at call site.
 * Never use function values — they cannot cross the server→client boundary.
 */
export const layoutI18n: Record<
  "en" | "zh-TW",
  Pick<AppDictionary, "switcher" | "commandPalette">
> = {
  en: {
    switcher: {
      triggerLabel: "Portfolio switcher",
      self: "My Portfolio",
      readonlyBadge: "Read-only",
      sharedBadge: "Delegated",
      eyebrow: "Shared context",
      contextStripTitle: "Viewing {owner}'s portfolio",
      contextStripSubtitle: "Your price color convention stays active while portfolio data is {owner}'s.",
      contextStripAction: "Back to my portfolio",
      manageSharing: "Manage sharing",
      viewMySharing: "View my sharing",
      sharedPortfolioSettings: "Portfolio settings",
      sharedPortfolioSharing: "Portfolio sharing",
      ownerOptionLabel: "{owner}'s Portfolio",
      readonlyDescription: "Writes are disabled while viewing a shared portfolio.",
      revokedFallback: "Shared portfolio access is no longer active. Returned to My Portfolio.",
      revokedFallbackOwner: "Access to {owner}'s portfolio was revoked.",
      sharedHoldingsEmpty: "{owner} hasn't added any holdings yet.",
      sharedTransactionsEmpty: "{owner} hasn't added any transactions yet.",
    },
    commandPalette: {
      placeholder: "Search anything…",
      empty: "No results",
      groupRoutes: "Routes",
      groupTickers: "Tickers",
      groupActions: "Actions",
      routeDashboard: "Dashboard",
      routeReports: "Reports",
      routePortfolio: "Portfolio",
      routeTransactions: "Transactions",
      routeCashLedger: "Cash Ledger",
      routeDividends: "Dividends",
      routeSharing: "Sharing",
      routeSettingsProfile: "Settings → Profile",
      routeSettingsGeneral: "Settings → General",
      routeSettingsAccounts: "Settings → Accounts",
      routeSettingsDisplay: "Settings → Display",
      routeSettingsTickers: "Settings → Tickers",
      actionThemeLight: "Switch to light",
      actionThemeSystem: "Switch to system",
      actionThemeDark: "Switch to dark",
      actionAccentPrefix: "Change accent to {accent}",
      actionAddTransaction: "Add transaction",
      quickActionsTitle: "Quick actions",
      quickActionsDescription: "Global actions for your current editable portfolio context.",
      actionRecomputeAll: "Recompute all positions",
      actionGenerateSnapshots: "Generate snapshots for current context",
      actionGenerateSnapshotsHint: "Only your current editable portfolio context is regenerated here. Broad repair/backfill is admin/system only.",
      actionChangeReportingCurrency: "Change reporting currency",
      actionReportingCurrencySaved: "Saved",
      recomputeConfirmTitle: "Recompute all positions?",
      recomputeConfirmBody:
        "This re-derives lots, allocations, and cash entries from your trade history. May take a few seconds.",
      recomputeConfirmCta: "Recompute",
      recomputeConfirmCancel: "Cancel",
      accent: {
        indigo: "Indigo",
        violet: "Violet",
        blue: "Blue",
        cyan: "Cyan",
        emerald: "Emerald",
        amber: "Amber",
        rose: "Rose",
        slate: "Slate",
      },
    },
  },
  "zh-TW": {
    switcher: {
      triggerLabel: "投資組合切換器",
      self: "我的投資組合",
      readonlyBadge: "唯讀",
      sharedBadge: "已授權",
      eyebrow: "分享情境",
      contextStripTitle: "正在檢視 {owner} 的投資組合",
      contextStripSubtitle: "即使資料來自 {owner} 的投資組合，你的漲跌色彩偏好仍會維持生效。",
      contextStripAction: "返回我的投資組合",
      manageSharing: "管理分享",
      viewMySharing: "查看我的分享",
      sharedPortfolioSettings: "投資組合設定",
      sharedPortfolioSharing: "投資組合分享",
      ownerOptionLabel: "{owner} 的投資組合",
      readonlyDescription: "正在檢視分享的投資組合時，無法執行寫入操作。",
      revokedFallback: "分享的投資組合存取已失效，已切回我的投資組合。",
      revokedFallbackOwner: "{owner} 的投資組合分享已被撤銷。",
      sharedHoldingsEmpty: "{owner} 尚未新增任何持股。",
      sharedTransactionsEmpty: "{owner} 尚未新增任何交易。",
    },
    commandPalette: {
      placeholder: "搜尋任何項目…",
      empty: "無相符結果",
      groupRoutes: "頁面",
      groupTickers: "代號",
      groupActions: "操作",
      routeDashboard: "儀表板",
      routeReports: "報表",
      routePortfolio: "投資組合",
      routeTransactions: "交易紀錄",
      routeCashLedger: "現金流水",
      routeDividends: "股利",
      routeSharing: "分享",
      routeSettingsProfile: "設定 → 個人檔案",
      routeSettingsGeneral: "設定 → 一般",
      routeSettingsAccounts: "設定 → 帳戶",
      routeSettingsDisplay: "設定 → 顯示",
      routeSettingsTickers: "設定 → 代號",
      actionThemeLight: "切換為淺色主題",
      actionThemeSystem: "切換為系統主題",
      actionThemeDark: "切換為深色主題",
      actionAccentPrefix: "強調色改為 {accent}",
      actionAddTransaction: "新增交易",
      quickActionsTitle: "快速操作",
      quickActionsDescription: "目前可編輯投資組合情境的全域操作。",
      actionRecomputeAll: "重算所有持倉",
      actionGenerateSnapshots: "為目前範圍產生快照",
      actionGenerateSnapshotsHint: "這裡只會重新產生目前可編輯投資組合情境的快照；大範圍修復與回補屬於管理員／系統流程。",
      actionChangeReportingCurrency: "變更報表幣別",
      actionReportingCurrencySaved: "已儲存",
      recomputeConfirmTitle: "確定要重算所有持倉？",
      recomputeConfirmBody:
        "系統會根據交易歷史重新推導所有批次、配置與現金紀錄，可能需要幾秒鐘。",
      recomputeConfirmCta: "重算",
      recomputeConfirmCancel: "取消",
      accent: {
        indigo: "靛藍",
        violet: "紫羅蘭",
        blue: "藍",
        cyan: "青",
        emerald: "翡翠綠",
        amber: "琥珀",
        rose: "玫瑰",
        slate: "石板灰",
      },
    },
  },
};

export interface LayoutShellLabels {
  themeToggle: {
    groupLabel: string;
    light: string;
    system: string;
    dark: string;
  };
  commandPaletteTrigger: {
    ariaLabel: string;
  };
  topBar: {
    toggleSidebarLabel: string;
    openNavigationLabel: string;
  };
  profileMenu: {
    triggerLabel: string;
    profileLink: string;
    adminLink: string;
    signOut: string;
    themeGroupLabel: string;
  };
  sidebarResizeRail: {
    ariaLabel: string;
    expandedTitle: string;
    collapsedTitle: string;
  };
}

const layoutShellLabels: Record<"en" | "zh-TW", LayoutShellLabels> = {
  en: {
    themeToggle: {
      groupLabel: "Theme",
      light: "Light",
      system: "System",
      dark: "Dark",
    },
    commandPaletteTrigger: {
      ariaLabel: "Open command palette",
    },
    topBar: {
      toggleSidebarLabel: "Toggle sidebar",
      openNavigationLabel: "Open navigation",
    },
    profileMenu: {
      triggerLabel: "User menu",
      profileLink: "Profile",
      adminLink: "Admin",
      signOut: "Sign out",
      themeGroupLabel: "Theme",
    },
    sidebarResizeRail: {
      ariaLabel: "Resize or toggle sidebar",
      expandedTitle: "Drag to resize; click to collapse; arrow keys adjust width",
      collapsedTitle: "Click to expand sidebar",
    },
  },
  "zh-TW": {
    themeToggle: {
      groupLabel: "主題",
      light: "淺色",
      system: "系統",
      dark: "深色",
    },
    commandPaletteTrigger: {
      ariaLabel: "開啟指令面板",
    },
    topBar: {
      toggleSidebarLabel: "切換側邊欄",
      openNavigationLabel: "開啟導覽",
    },
    profileMenu: {
      triggerLabel: "使用者選單",
      profileLink: "個人資料",
      adminLink: "管理",
      signOut: "登出",
      themeGroupLabel: "主題",
    },
    sidebarResizeRail: {
      ariaLabel: "調整或切換側邊欄",
      expandedTitle: "拖曳可調整寬度；點擊可收合；可用方向鍵微調寬度",
      collapsedTitle: "點擊以展開側邊欄",
    },
  },
};

export function getLayoutShellLabels(locale: LocaleCode): LayoutShellLabels {
  return layoutShellLabels[locale === "zh-TW" ? "zh-TW" : "en"];
}

export interface RouteLoadingCopy {
  ariaLabel: string;
  eyebrow: string;
  title: string;
  body: string;
}

export interface RouteLoadingLabels {
  dashboard: RouteLoadingCopy;
  reports: RouteLoadingCopy;
  portfolio: RouteLoadingCopy;
  transactions: RouteLoadingCopy;
  cashLedger: RouteLoadingCopy;
  dividends: RouteLoadingCopy;
  settings: RouteLoadingCopy;
  tickerDetail: RouteLoadingCopy;
}

const routeLoadingLabels: Record<"en" | "zh-TW", RouteLoadingLabels> = {
  en: {
    dashboard: {
      ariaLabel: "Loading dashboard",
      eyebrow: "Dashboard",
      title: "Loading dashboard",
      body: "Preparing valuation, market context, and portfolio command surfaces.",
    },
    reports: {
      ariaLabel: "Loading reports",
      eyebrow: "Reports",
      title: "Loading reports",
      body: "Preparing performance, allocation, and income report views.",
    },
    portfolio: {
      ariaLabel: "Loading portfolio workspace",
      eyebrow: "Portfolio",
      title: "Loading portfolio workspace",
      body: "Preparing holdings, allocation context, and the table-first review surface.",
    },
    transactions: {
      ariaLabel: "Loading transactions workspace",
      eyebrow: "Transactions",
      title: "Loading transactions workspace",
      body: "Preparing the ledger, inbox context, and transaction entry tools.",
    },
    cashLedger: {
      ariaLabel: "Loading cash ledger",
      eyebrow: "Cash Ledger",
      title: "Loading cash ledger",
      body: "Preparing cash entries, account context, and review controls.",
    },
    dividends: {
      ariaLabel: "Loading dividends",
      eyebrow: "Dividends",
      title: "Loading dividends",
      body: "Preparing dividend calendar, ledger review, and account context.",
    },
    settings: {
      ariaLabel: "Loading settings",
      eyebrow: "Settings",
      title: "Loading settings",
      body: "Preparing account, display, and profile controls for this section.",
    },
    tickerDetail: {
      ariaLabel: "Loading ticker detail",
      eyebrow: "Tickers",
      title: "Loading ticker detail",
      body: "Preparing price history, fundamentals, and your current position context.",
    },
  },
  "zh-TW": {
    dashboard: {
      ariaLabel: "載入儀表板中",
      eyebrow: "儀表板",
      title: "載入儀表板中",
      body: "正在準備估值、市場情境，以及投資組合操作區。",
    },
    reports: {
      ariaLabel: "載入報表中",
      eyebrow: "報表",
      title: "載入報表中",
      body: "正在準備績效、配置與收益報表視圖。",
    },
    portfolio: {
      ariaLabel: "載入投資組合工作區中",
      eyebrow: "投資組合",
      title: "載入投資組合工作區中",
      body: "正在準備持股、配置情境，以及以表格為主的檢查畫面。",
    },
    transactions: {
      ariaLabel: "載入交易工作區中",
      eyebrow: "交易",
      title: "載入交易工作區中",
      body: "正在準備交易紀錄、收件匣情境，以及交易輸入工具。",
    },
    cashLedger: {
      ariaLabel: "載入現金流水中",
      eyebrow: "現金流水",
      title: "載入現金流水中",
      body: "正在準備現金紀錄、帳戶情境，以及檢查控制項。",
    },
    dividends: {
      ariaLabel: "載入股利中",
      eyebrow: "股利",
      title: "載入股利中",
      body: "正在準備股利行事曆、帳本檢查與帳戶情境。",
    },
    settings: {
      ariaLabel: "載入設定中",
      eyebrow: "設定",
      title: "載入設定中",
      body: "正在準備此區段的帳戶、顯示與個人資料控制項。",
    },
    tickerDetail: {
      ariaLabel: "載入代號明細中",
      eyebrow: "代號",
      title: "載入代號明細中",
      body: "正在準備價格歷史、基本資料，以及你目前的持倉情境。",
    },
  },
};

export function getRouteLoadingLabels(locale?: LocaleCode | string): RouteLoadingLabels {
  return routeLoadingLabels[locale === "zh-TW" ? "zh-TW" : "en"];
}
