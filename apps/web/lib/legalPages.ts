import type { AuthPageLocale } from "./authPages";

export type LegalPageKind = "terms" | "privacy";

interface LegalSection {
  title: string;
  body: string;
}

interface LegalPageCopy {
  eyebrow: string;
  title: string;
  description: string;
  updatedLabel: string;
  sections: LegalSection[];
  backToLogin: string;
}

export const legalPageCopy: Record<AuthPageLocale, Record<LegalPageKind, LegalPageCopy>> = {
  en: {
    terms: {
      eyebrow: "Legal",
      title: "Terms of Use",
      description:
        "These terms describe the baseline expectations for using Vakwen. Deployment-specific policies may add stricter rules.",
      updatedLabel: "Last updated: May 30, 2026",
      sections: [
        {
          title: "Use of the service",
          body:
            "Vakwen helps you track portfolio records that you enter, import, or authorize. You are responsible for keeping your account credentials secure and for verifying the accuracy of your data.",
        },
        {
          title: "No financial advice",
          body:
            "Portfolio values, market data, analytics, and AI-assisted summaries are informational only. They are not financial, legal, tax, or investment advice.",
        },
        {
          title: "Access and availability",
          body:
            "Access may depend on a valid Google session, invite status, administrator settings, and connected data providers. The service may be changed, limited, or unavailable during maintenance.",
        },
      ],
      backToLogin: "Back to login",
    },
    privacy: {
      eyebrow: "Legal",
      title: "Privacy Notice",
      description:
        "This notice summarizes the data Vakwen uses to operate the portfolio tracker. Deployment operators may define additional retention or compliance policies.",
      updatedLabel: "Last updated: May 30, 2026",
      sections: [
        {
          title: "Account data",
          body:
            "Vakwen uses your Google identity to authenticate you and associate portfolio records, preferences, settings, and sharing choices with your account.",
        },
        {
          title: "Portfolio and provider data",
          body:
            "The service stores portfolio records and may call configured market-data providers to refresh quotes, catalog metadata, dividends, and related operational status.",
        },
        {
          title: "Operational logs",
          body:
            "The service may keep audit, error, and health information needed to operate the app, diagnose issues, and protect access-controlled pages.",
        },
      ],
      backToLogin: "Back to login",
    },
  },
  "zh-TW": {
    terms: {
      eyebrow: "法律資訊",
      title: "服務條款",
      description: "這些條款說明使用 Vakwen 的基本期待。不同部署環境可能會有更嚴格的政策。",
      updatedLabel: "最後更新：2026 年 5 月 30 日",
      sections: [
        {
          title: "服務使用",
          body:
            "Vakwen 協助你追蹤自行輸入、匯入或授權的投資組合紀錄。你需自行保護帳號憑證，並確認資料正確性。",
        },
        {
          title: "非財務建議",
          body:
            "投資組合數值、市場資料、分析與 AI 輔助摘要僅供參考，並非財務、法律、稅務或投資建議。",
        },
        {
          title: "存取與可用性",
          body:
            "服務存取可能取決於有效的 Google 工作階段、邀請狀態、管理員設定與連接的資料提供者。維護期間服務可能變更、受限或暫時無法使用。",
        },
      ],
      backToLogin: "回到登入頁",
    },
    privacy: {
      eyebrow: "法律資訊",
      title: "隱私權政策",
      description:
        "本政策摘要說明 Vakwen 為運作投資組合追蹤器所使用的資料。部署營運者可能會定義額外的保存或合規政策。",
      updatedLabel: "最後更新：2026 年 5 月 30 日",
      sections: [
        {
          title: "帳號資料",
          body:
            "Vakwen 使用你的 Google 身分進行驗證，並將投資組合紀錄、偏好設定、系統設定與分享選項關聯到你的帳號。",
        },
        {
          title: "投資組合與資料提供者資料",
          body:
            "服務會保存投資組合紀錄，並可能呼叫已設定的市場資料提供者以更新報價、商品目錄中繼資料、股利與相關營運狀態。",
        },
        {
          title: "營運紀錄",
          body:
            "服務可能保存稽核、錯誤與健康狀態資訊，用於維運、診斷問題，以及保護需要權限控管的頁面。",
        },
      ],
      backToLogin: "回到登入頁",
    },
  },
};
