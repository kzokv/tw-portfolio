import type { LocaleCode } from "@vakwen/shared-types";

export interface ShareNotificationDictionary {
  shareGranted: {
    title: string;
    body: string;
  };
  shareRevoked: {
    title: string;
    body: string;
  };
  anonymousOwnerFallback: string;
}

export const shareNotificationStrings: Record<LocaleCode, ShareNotificationDictionary> = {
  en: {
    shareGranted: {
      title: "Portfolio shared with you",
      body: "{ownerLabel} shared their portfolio with you. Open the switcher to view.",
    },
    shareRevoked: {
      title: "Portfolio access revoked",
      body: "{ownerLabel} revoked your access to their portfolio.",
    },
    anonymousOwnerFallback: "Someone",
  },
  "zh-TW": {
    shareGranted: {
      title: "有人與你分享了投資組合",
      body: "{ownerLabel} 已將其投資組合分享給你。開啟切換器以檢視。",
    },
    shareRevoked: {
      title: "投資組合存取權已撤銷",
      body: "{ownerLabel} 已撤銷你對其投資組合的存取權。",
    },
    anonymousOwnerFallback: "某人",
  },
};
