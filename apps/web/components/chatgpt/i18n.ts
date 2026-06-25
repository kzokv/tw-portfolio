import type { LocaleCode } from "@vakwen/shared-types";
import { getOpenAiBridge } from "./openaiBridge";

export const chatGptTransactionDraftCopy: Record<LocaleCode, {
  shellTitle: string;
  waitingForBridge: string;
  bridgeOnly: string;
  noRawFile: string;
  rows: string;
  needsReview: string;
  writeEnabled: string;
  writeNotGranted: string;
  bridgeNote: string;
  bridgeDescription: string;
  requiresWriteReconsent: string;
  typedConfirmationRequired: string;
  widgetActionFailed: string;
  rowSaved: string;
  rowsExcluded: string;
  rowsReincluded: string;
  rowsRejected: string;
  batchArchived: string;
  batchDeleted: string;
  rowsPosted: string;
  manualFeeSource: string;
  sourceProvidedFeeSource: string;
  calculatedFeeSource: string;
  feeSourceFallback: string;
  manualZeroCommissionWarning: string;
  draftPostingPreview: string;
  unassigned: string;
}> = {
  en: {
    shellTitle: "Vakwen transaction draft",
    waitingForBridge: "Waiting for the MCP Apps bridge to provide draft state.",
    bridgeOnly: "MCP Apps bridge only",
    noRawFile: "No raw file sent to Vakwen",
    rows: "rows",
    needsReview: "need review",
    writeEnabled: "transaction:write enabled",
    writeNotGranted: "transaction:write not granted",
    bridgeNote: "Bridge note",
    bridgeDescription: "Actions in this component use `window.openai.callTool(...)` and `window.openai.setWidgetState(...)`. The iframe does not call the Vakwen API directly and does not depend on a Vakwen web session.",
    requiresWriteReconsent: "`transaction:write` remains an advanced scope. Reconnect or re-consent in ChatGPT before this widget can post rows.",
    typedConfirmationRequired: "Typed confirmation required before posting.",
    widgetActionFailed: "Widget action failed.",
    rowSaved: "Row saved.",
    rowsExcluded: "Rows excluded.",
    rowsReincluded: "Rows re-included.",
    rowsRejected: "Rows rejected.",
    batchArchived: "Batch archived.",
    batchDeleted: "Batch deleted.",
    rowsPosted: "Selected rows posted.",
    manualFeeSource: "Manual",
    sourceProvidedFeeSource: "Source provided",
    calculatedFeeSource: "Calculated",
    feeSourceFallback: "N/A",
    manualZeroCommissionWarning: "Manual zero commission differs from calculated fee",
    draftPostingPreview: "Draft posting preview",
    unassigned: "Unassigned",
  },
  "zh-TW": {
    shellTitle: "Vakwen 交易草稿",
    waitingForBridge: "正在等待 MCP Apps bridge 提供草稿狀態。",
    bridgeOnly: "僅限 MCP Apps bridge",
    noRawFile: "未將原始檔案傳送到 Vakwen",
    rows: "筆資料",
    needsReview: "筆待檢查",
    writeEnabled: "已授權 transaction:write",
    writeNotGranted: "尚未授權 transaction:write",
    bridgeNote: "Bridge 說明",
    bridgeDescription: "此元件中的操作會使用 `window.openai.callTool(...)` 與 `window.openai.setWidgetState(...)`。iframe 不會直接呼叫 Vakwen API，也不依賴 Vakwen 網頁工作階段。",
    requiresWriteReconsent: "`transaction:write` 仍屬於進階權限。請先在 ChatGPT 重新連線或重新同意，此元件才能送出資料列。",
    typedConfirmationRequired: "送出前需要輸入確認字串。",
    widgetActionFailed: "元件操作失敗。",
    rowSaved: "已儲存資料列。",
    rowsExcluded: "已排除資料列。",
    rowsReincluded: "已重新納入資料列。",
    rowsRejected: "已拒絕資料列。",
    batchArchived: "已封存批次。",
    batchDeleted: "已刪除批次。",
    rowsPosted: "已送出所選資料列。",
    manualFeeSource: "手動",
    sourceProvidedFeeSource: "來源提供",
    calculatedFeeSource: "系統計算",
    feeSourceFallback: "N/A",
    manualZeroCommissionWarning: "手動指定零手續費與系統計算結果不同",
    draftPostingPreview: "交易草稿送出預覽",
    unassigned: "未指派",
  },
};

export const chatGptAccountManagerCopy: Record<LocaleCode, {
  shellTitle: string;
  waitingForBridge: string;
  scopeBadge: string;
  refresh: string;
  refreshed: string;
  accountActionFailed: string;
  refreshHint: string;
  accountsTitle: string;
  accountsDescription: string;
  activeCount: string;
  deletedCount: string;
  noFeeProfile: string;
  edit: string;
  archive: string;
  accountArchived: string;
  recentlyDeleted: string;
  restore: string;
  accountRestored: string;
  addAccount: string;
  editAccount: string;
  composerDescription: string;
  cancel: string;
  accountName: string;
  currency: string;
  accountType: string;
  broker: string;
  bank: string;
  wallet: string;
  saveChanges: string;
  accountUpdated: string;
  accountCreated: string;
  scopeGuardrails: string;
  guardrailName: string;
  guardrailImmutable: string;
  guardrailSoftDelete: string;
}> = {
  en: {
    shellTitle: "Vakwen account manager",
    waitingForBridge: "Waiting for the MCP Apps bridge to provide account state.",
    scopeBadge: "account:manage scope",
    refresh: "Refresh",
    refreshed: "Account manager refreshed.",
    accountActionFailed: "Account action failed.",
    refreshHint: "Refresh accounts to see the latest account list.",
    accountsTitle: "Accounts",
    accountsDescription: "Visible names are what ChatGPT shows to users; IDs stay hidden for routing and tool calls.",
    activeCount: "active",
    deletedCount: "deleted",
    noFeeProfile: "No fee profile linked",
    edit: "Edit",
    archive: "Archive",
    accountArchived: "Account archived.",
    recentlyDeleted: "Recently deleted",
    restore: "Restore",
    accountRestored: "Account restored.",
    addAccount: "Add account",
    editAccount: "Edit account",
    composerDescription: "Currency is fixed after creation in this MCP flow, so editing only changes the visible name.",
    cancel: "Cancel",
    accountName: "Account name",
    currency: "Currency",
    accountType: "Account type",
    broker: "Broker",
    bank: "Bank",
    wallet: "Wallet",
    saveChanges: "Save changes",
    accountUpdated: "Account updated.",
    accountCreated: "Account created.",
    scopeGuardrails: "Scope guardrails",
    guardrailName: "Account names are user-facing labels; IDs remain internal.",
    guardrailImmutable: "Currency and account type are fixed once created in this pass.",
    guardrailSoftDelete: "Soft delete keeps historical transactions addressable.",
  },
  "zh-TW": {
    shellTitle: "Vakwen 帳戶管理",
    waitingForBridge: "正在等待 MCP Apps bridge 提供帳戶狀態。",
    scopeBadge: "account:manage 權限",
    refresh: "重新整理",
    refreshed: "已重新整理帳戶管理。",
    accountActionFailed: "帳戶操作失敗。",
    refreshHint: "請重新整理帳戶，以查看最新帳戶清單。",
    accountsTitle: "帳戶",
    accountsDescription: "顯示名稱會提供給 ChatGPT 對使用者呈現；ID 仍只用於路由與工具呼叫。",
    activeCount: "啟用中",
    deletedCount: "已刪除",
    noFeeProfile: "尚未連結手續費設定",
    edit: "編輯",
    archive: "封存",
    accountArchived: "已封存帳戶。",
    recentlyDeleted: "最近刪除",
    restore: "還原",
    accountRestored: "已還原帳戶。",
    addAccount: "新增帳戶",
    editAccount: "編輯帳戶",
    composerDescription: "在此 MCP 流程中，幣別建立後即固定，因此編輯只會變更顯示名稱。",
    cancel: "取消",
    accountName: "帳戶名稱",
    currency: "幣別",
    accountType: "帳戶類型",
    broker: "券商",
    bank: "銀行",
    wallet: "錢包",
    saveChanges: "儲存變更",
    accountUpdated: "已更新帳戶。",
    accountCreated: "已建立帳戶。",
    scopeGuardrails: "權限防護說明",
    guardrailName: "帳戶名稱是對使用者顯示的標籤；ID 仍維持內部使用。",
    guardrailImmutable: "在這次流程中建立後，幣別與帳戶類型即固定。",
    guardrailSoftDelete: "軟刪除會保留歷史交易的可追溯性。",
  },
};

export function normalizeChatGptLocale(locale?: LocaleCode | string): LocaleCode {
  if (locale === "zh-TW") return "zh-TW";
  const bridgeLocale = getOpenAiBridge()?.locale;
  return bridgeLocale === "zh-TW" ? "zh-TW" : "en";
}
