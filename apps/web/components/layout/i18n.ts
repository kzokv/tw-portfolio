import type { AppDictionary } from "../../lib/i18n/types";

/**
 * Layout/chrome i18n — strings that belong to the outer shell (TopBar, sidebar,
 * portfolio switcher) rather than any feature slice.
 *
 * Placeholders use `{token}` template form (per nextjs-i18n-serialization.md):
 *   - `ownerOptionLabel` interpolates `{owner}` at call site.
 * Never use function values — they cannot cross the server→client boundary.
 */
export const layoutI18n: Record<"en" | "zh-TW", Pick<AppDictionary, "switcher">> = {
  en: {
    switcher: {
      triggerLabel: "Portfolio switcher",
      self: "My Portfolio",
      readonlyBadge: "Read-only",
      eyebrow: "Viewing shared portfolio",
      manageSharing: "Manage sharing",
      ownerOptionLabel: "{owner}'s Portfolio",
      readonlyDescription: "Writes are disabled while viewing a shared portfolio.",
      revokedFallback: "Shared portfolio access is no longer active. Returned to My Portfolio.",
      revokedFallbackOwner: "Access to {owner}'s portfolio was revoked.",
      sharedHoldingsEmpty: "{owner} hasn't added any holdings yet.",
      sharedTransactionsEmpty: "{owner} hasn't added any transactions yet.",
    },
  },
  "zh-TW": {
    switcher: {
      triggerLabel: "投資組合切換器",
      self: "我的投資組合",
      readonlyBadge: "唯讀",
      eyebrow: "正在檢視分享的投資組合",
      manageSharing: "管理分享",
      ownerOptionLabel: "{owner} 的投資組合",
      readonlyDescription: "正在檢視分享的投資組合時，無法執行寫入操作。",
      revokedFallback: "分享的投資組合存取已失效，已切回我的投資組合。",
      revokedFallbackOwner: "{owner} 的投資組合分享已被撤銷。",
      sharedHoldingsEmpty: "{owner} 尚未新增任何持股。",
      sharedTransactionsEmpty: "{owner} 尚未新增任何交易。",
    },
  },
};
