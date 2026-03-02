import type { AppDictionary } from "../../lib/i18n/types";

export const dashboardI18n: Record<"en" | "zh-TW", Pick<AppDictionary, "topBar" | "hero" | "dialogs"> & {
  tooltips: Pick<AppDictionary["tooltips"], "appTitle" | "heroTitle">;
}> = {
  en: {
    topBar: {
      productName: "Taiwan Portfolio",
      title: "Market Ledger",
      titleTooltip: "Central workspace for portfolio state, trade history, and settings.",
      openSettingsLabel: "Open settings drawer",
    },
    hero: {
      eyebrow: "Operational Snapshot",
      title: "Taiwan Portfolio Control Room",
      titleTooltip: "Live command center for trades, holdings, and fee/tax settings.",
      description: "Manage trades, audit holdings, and tune settings from one streamlined workspace.",
    },
    dialogs: {
      integrityTitle: "Configuration Issue Detected",
      integrityDescription: "One or more accounts are missing valid fee profile bindings.",
    },
    tooltips: {
      appTitle: "Use the avatar in the top-right to open settings drawer.",
      heroTitle: "Overview panel showing current actions and configuration context.",
    },
  },
  "zh-TW": {
    topBar: {
      productName: "台灣投資組合",
      title: "市場帳本",
      titleTooltip: "投資組合狀態、交易紀錄與設定的集中工作區。",
      openSettingsLabel: "開啟設定抽屜",
    },
    hero: {
      eyebrow: "營運概覽",
      title: "台灣投資組合控制台",
      titleTooltip: "交易、持倉與費稅設定的即時控制中心。",
      description: "在同一個工作區中管理交易、檢視持倉並調整設定。",
    },
    dialogs: {
      integrityTitle: "偵測到設定異常",
      integrityDescription: "有帳戶缺少有效費率設定綁定，請先修正後再進行交易。",
    },
    tooltips: {
      appTitle: "點右上角頭像可開啟設定抽屜。",
      heroTitle: "顯示目前操作與設定狀態的總覽區塊。",
    },
  },
};
