import type { LocaleCode } from "@vakwen/shared-types";
import { getOpenAiBridge } from "./openaiBridge";

interface ChatGptTransactionDraftCopy {
  shellTitle: string;
  shellDescription: string;
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
  draftRefreshed: string;
  refresh: string;
  openInVakwen: string;
  tabImport: string;
  tabReview: string;
  tabPost: string;
  source: string;
  temporaryChatGptImport: string;
  preflightComplete: string;
  batch: string;
  rowsMetricLabel: string;
  selectedCount: (count: string) => string;
  readyMetricLabel: string;
  readyEligible: string;
  readyReviewOnly: string;
  needsReviewMetricLabel: string;
  needsReviewDetail: string;
  grossValueMetricLabel: string;
  typedConfirmationRequiredDetail: string;
  buttonConfirmationDetail: string;
  connectorProvenance: string;
  channel: string;
  rowMappings: string;
  notProvided: string;
  structuredPayload: string;
  structuredCandidatesOnly: string;
  additionalComponentMetadata: string;
  snippetCap: string;
  snippetCapValue: (count: number) => string;
  unsupportedRowsTitle: string;
  unsupportedRowsDescription: string;
  account: string;
  ticker: string;
  side: string;
  quantity: string;
  price: string;
  fees: string;
  date: string;
  status: string;
  actions: string;
  selectDraftRow: (rowNumber: number) => string;
  inputValuePrefix: string;
  matchedAccount: string;
  editRowSr: string;
  exclude: string;
  reinclude: string;
  reject: string;
  archive: string;
  delete: string;
  postSelectedRows: string;
  postDescription: string;
  selectedReadyRows: string;
  confirmedRows: string;
  postingScope: string;
  granted: string;
  notGranted: string;
  postingPreviewDescription: string;
  commission: string;
  tax: string;
  feeSource: string;
  netCashImpact: string;
  currency: string;
  totalBuys: string;
  totalSells: string;
  totalCommission: string;
  totalTax: string;
  requiresWriteReconsentDefault: string;
  highValueConfirmation: string;
  postingConfirmation: string;
  highValueConfirmationDescription: string;
  postingConfirmationDescription: string;
  requiredPhrase: string;
  postSelected: string;
  confirmationRequired: string;
  latestPostingResult: string;
  typePhraseBeforePosting: (phrase: string) => string;
  postedRowsCreatedTransactions: (rows: number, transactions: number) => string;
  remainingUnresolvedRows: string;
  selectedRowEdit: string;
  selectedRowEditDescription: string;
  close: string;
  editFieldLabels: Record<string, string>;
  selectAccount: string;
  note: string;
  sourceSnippet: string;
  saveRow: string;
  chooseRowToEdit: string;
  validationDetails: string;
  manualZeroFeeOverrideWarning: string;
  auditPreview: string;
  reviewOrContinueInVakwen: string;
  rowStateLabels: Record<string, string>;
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
}

export const chatGptTransactionDraftCopy: Record<LocaleCode, ChatGptTransactionDraftCopy> = {
  en: {
    shellTitle: "Vakwen transaction draft",
    shellDescription: "Connector-mediated import from ChatGPT with guarded posting.",
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
    draftRefreshed: "Draft refreshed.",
    refresh: "Refresh",
    openInVakwen: "Open in Vakwen",
    tabImport: "Import",
    tabReview: "Review",
    tabPost: "Post",
    source: "Source",
    temporaryChatGptImport: "Temporary ChatGPT import",
    preflightComplete: "preflight complete",
    batch: "batch",
    rowsMetricLabel: "Rows",
    selectedCount: (count) => `${count} selected`,
    readyMetricLabel: "Ready",
    readyEligible: "Eligible to post",
    readyReviewOnly: "Review only",
    needsReviewMetricLabel: "Needs review",
    needsReviewDetail: "Clarifications or conflicts",
    grossValueMetricLabel: "Gross value",
    typedConfirmationRequiredDetail: "Typed confirmation required",
    buttonConfirmationDetail: "Button confirmation",
    connectorProvenance: "Connector provenance",
    channel: "Channel",
    rowMappings: "Row mappings",
    notProvided: "Not provided",
    structuredPayload: "Structured payload",
    structuredCandidatesOnly: "Structured candidates plus capped provenance only",
    additionalComponentMetadata: "Includes additional component metadata",
    snippetCap: "Snippet cap",
    snippetCapValue: (count) => `${count} characters per row`,
    unsupportedRowsTitle: "Unsupported rows kept for review",
    unsupportedRowsDescription: "Vakwen preserved non-trade lines for audit, but they will not post as transactions.",
    account: "Account",
    ticker: "Ticker",
    side: "Side",
    quantity: "Quantity",
    price: "Price",
    fees: "Fees",
    date: "Date",
    status: "Status",
    actions: "Actions",
    selectDraftRow: (rowNumber) => `Select draft row ${rowNumber}`,
    inputValuePrefix: "Input",
    matchedAccount: "Matched account",
    editRowSr: "Edit row",
    exclude: "Exclude",
    reinclude: "Reinclude",
    reject: "Reject",
    archive: "Archive",
    delete: "Delete",
    postSelectedRows: "Post selected rows",
    postDescription: "Posting reuses Vakwen's canonical transaction creation path. Deterministic validation runs again before any write succeeds.",
    selectedReadyRows: "Selected ready rows",
    confirmedRows: "Confirmed rows",
    postingScope: "Posting scope",
    granted: "Granted",
    notGranted: "Not granted",
    postingPreviewDescription: "Server-computed account confirmation, fee source, and net cash impact before posting.",
    commission: "Commission",
    tax: "Tax",
    feeSource: "Fee source",
    netCashImpact: "Net cash impact",
    currency: "Currency",
    totalBuys: "Total buys",
    totalSells: "Total sells",
    totalCommission: "Total commission",
    totalTax: "Total tax",
    requiresWriteReconsentDefault: "`transaction:write` is off by default. Reconnect in ChatGPT and opt in during consent before this widget can post.",
    highValueConfirmation: "High-value confirmation",
    postingConfirmation: "Posting confirmation",
    highValueConfirmationDescription: "This batch crosses the current risk threshold. Type the confirmation phrase before posting.",
    postingConfirmationDescription: "Up to five low-risk rows can post after one explicit confirmation.",
    requiredPhrase: "Required phrase",
    postSelected: "Post selected",
    confirmationRequired: "Confirmation required",
    latestPostingResult: "Latest posting result",
    typePhraseBeforePosting: (phrase) => `Type ${phrase} before posting these rows.`,
    postedRowsCreatedTransactions: (rows, transactions) => `Posted ${rows} rows and created ${transactions} transactions.`,
    remainingUnresolvedRows: "Remaining unresolved rows",
    selectedRowEdit: "Selected row edit",
    selectedRowEditDescription: "Saving re-runs deterministic preflight and returns the current row state.",
    close: "Close",
    editFieldLabels: {
      accountName: "Account",
      marketCode: "Market",
      quantity: "Quantity",
      unitPrice: "Unit price",
      commissionAmount: "Commission",
      taxAmount: "Tax",
    },
    selectAccount: "Select account",
    note: "Note",
    sourceSnippet: "Source snippet",
    saveRow: "Save row",
    chooseRowToEdit: "Choose a row from Review to edit it here.",
    validationDetails: "Validation details",
    manualZeroFeeOverrideWarning: "Manual zero-fee overrides remain explicit and will not be recalculated unless you clear them.",
    auditPreview: "Audit preview",
    reviewOrContinueInVakwen: "Review or continue in Vakwen",
    rowStateLabels: {
      ready: "ready",
      confirmed: "confirmed",
      excluded: "excluded",
      rejected: "rejected",
      unsupported: "unsupported",
      needs_clarification: "needs clarification",
    },
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
    shellDescription: "由 ChatGPT 經連接器匯入，並以防護機制控管送出。",
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
    draftRefreshed: "已重新整理草稿。",
    refresh: "重新整理",
    openInVakwen: "在 Vakwen 開啟",
    tabImport: "匯入",
    tabReview: "檢查",
    tabPost: "送出",
    source: "來源",
    temporaryChatGptImport: "暫時 ChatGPT 匯入",
    preflightComplete: "預檢完成",
    batch: "批次",
    rowsMetricLabel: "資料列",
    selectedCount: (count) => `${count} 筆已選取`,
    readyMetricLabel: "可送出",
    readyEligible: "可送出",
    readyReviewOnly: "僅供檢查",
    needsReviewMetricLabel: "待檢查",
    needsReviewDetail: "需要釐清或有衝突",
    grossValueMetricLabel: "總額",
    typedConfirmationRequiredDetail: "需要輸入確認字串",
    buttonConfirmationDetail: "按鈕確認",
    connectorProvenance: "連接器來源",
    channel: "通道",
    rowMappings: "資料列對應",
    notProvided: "未提供",
    structuredPayload: "結構化內容",
    structuredCandidatesOnly: "只包含結構化候選資料與截斷來源資訊",
    additionalComponentMetadata: "包含額外元件中繼資料",
    snippetCap: "片段上限",
    snippetCapValue: (count) => `每筆資料列 ${count} 個字元`,
    unsupportedRowsTitle: "保留供檢查的不支援資料列",
    unsupportedRowsDescription: "Vakwen 會為了稽核保留非交易資料列，但這些資料不會送出為交易。",
    account: "帳戶",
    ticker: "代號",
    side: "方向",
    quantity: "數量",
    price: "價格",
    fees: "費用",
    date: "日期",
    status: "狀態",
    actions: "操作",
    selectDraftRow: (rowNumber) => `選取草稿資料列 ${rowNumber}`,
    inputValuePrefix: "輸入值",
    matchedAccount: "已配對帳戶",
    editRowSr: "編輯資料列",
    exclude: "排除",
    reinclude: "重新納入",
    reject: "拒絕",
    archive: "封存",
    delete: "刪除",
    postSelectedRows: "送出所選資料列",
    postDescription: "送出流程會重用 Vakwen 的正式交易建立路徑，任何寫入成功前都會再次執行確定性驗證。",
    selectedReadyRows: "已選可送出資料列",
    confirmedRows: "已確認資料列",
    postingScope: "送出權限",
    granted: "已授權",
    notGranted: "未授權",
    postingPreviewDescription: "送出前先確認由伺服器計算的帳戶、費用來源與淨現金影響。",
    commission: "手續費",
    tax: "稅額",
    feeSource: "費用來源",
    netCashImpact: "淨現金影響",
    currency: "幣別",
    totalBuys: "買入總額",
    totalSells: "賣出總額",
    totalCommission: "手續費總額",
    totalTax: "稅額總額",
    requiresWriteReconsentDefault: "`transaction:write` 預設關閉。請先在 ChatGPT 重新連線並於同意流程中選取此權限，此元件才能送出。",
    highValueConfirmation: "高金額確認",
    postingConfirmation: "送出確認",
    highValueConfirmationDescription: "此批次已超過目前風險門檻。送出前請輸入確認字串。",
    postingConfirmationDescription: "最多五筆低風險資料列可在一次明確確認後送出。",
    requiredPhrase: "必要字串",
    postSelected: "送出所選項目",
    confirmationRequired: "需要確認",
    latestPostingResult: "最新送出結果",
    typePhraseBeforePosting: (phrase) => `送出這些資料列前，請輸入 ${phrase}。`,
    postedRowsCreatedTransactions: (rows, transactions) => `已送出 ${rows} 筆資料列，並建立 ${transactions} 筆交易。`,
    remainingUnresolvedRows: "剩餘未解決資料列",
    selectedRowEdit: "編輯已選資料列",
    selectedRowEditDescription: "儲存後會重新執行確定性預檢，並回傳目前資料列狀態。",
    close: "關閉",
    editFieldLabels: {
      accountName: "帳戶",
      marketCode: "市場",
      quantity: "數量",
      unitPrice: "單價",
      commissionAmount: "手續費",
      taxAmount: "稅額",
    },
    selectAccount: "選擇帳戶",
    note: "備註",
    sourceSnippet: "來源片段",
    saveRow: "儲存資料列",
    chooseRowToEdit: "請先在「檢查」分頁選取資料列，再於此編輯。",
    validationDetails: "驗證細節",
    manualZeroFeeOverrideWarning: "手動指定的零費用覆寫會維持明確狀態，除非你清除它們，否則不會重新計算。",
    auditPreview: "稽核預覽",
    reviewOrContinueInVakwen: "在 Vakwen 檢查或繼續處理",
    rowStateLabels: {
      ready: "可送出",
      confirmed: "已確認",
      excluded: "已排除",
      rejected: "已拒絕",
      unsupported: "不支援",
      needs_clarification: "需釐清",
    },
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
