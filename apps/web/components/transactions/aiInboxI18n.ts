import type { LocaleCode } from "@vakwen/shared-types";

export const aiInboxCopy: Record<LocaleCode, {
  title: string;
  openBatches: string;
  ready: string;
  needsReview: string;
  refresh: string;
  loadError: string;
  actionError: string;
  draftBatches: string;
  loadingBatches: string;
  noBatches: string;
  sourceChannelMcp: string;
  sourceChannelWeb: string;
  selectBatch: string;
  draftBatchFallback: string;
  rowsLabel: string;
  unsupportedLabel: string;
  statusLabel: string;
  versionLabel: string;
  connectorLabel: string;
  rowsPosted: string;
  exclude: string;
  reinclude: string;
  reject: string;
  archive: string;
  delete: string;
  rowsExcluded: string;
  rowsReincluded: string;
  rowsRejected: string;
  batchArchived: string;
  batchDeleted: string;
  connectorProvenance: string;
  connectorProvenanceMcp: string;
  connectorProvenanceWeb: string;
  sourceLabel: string;
  sourceLabelFallback: string;
  sourceSnippetsCapped: string;
  openDeepLink: string;
  auditNote: string;
  readyRowsSelected: string;
  typedConfirmation: string;
  postSelected: string;
  rowsPostedMessage: string;
  twdGross: string;
  unsupportedRows: string;
  unsupportedRowsDescription: string;
  rowLabel: string;
  tableStatus: string;
  tableTrade: string;
  tableAccount: string;
  tableGross: string;
  tableFees: string;
  tableIssues: string;
  tableEdit: string;
  calculatedFees: string;
  editRow: string;
  close: string;
  rowSaved: string;
  saveRow: string;
  version: string;
  account: string;
  type: string;
  ticker: string;
  market: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  tradeDate: string;
  timestamp: string;
  sequence: string;
  commission: string;
  tax: string;
  dayTrade: string;
  unset: string;
  no: string;
  yes: string;
  note: string;
  sourceSnippet: string;
  validationDetails: string;
  archiveConfirm: string;
  deleteConfirm: string;
  notProvided: string;
  ariaSelectRow: string;
  postedTransactionDeleted: string;
}> = {
  en: {
    title: "AI Inbox",
    openBatches: "open batches",
    ready: "ready",
    needsReview: "need review",
    refresh: "Refresh",
    loadError: "AI Inbox could not be loaded.",
    actionError: "AI Inbox action failed.",
    draftBatches: "Draft batches",
    loadingBatches: "Loading batches...",
    noBatches: "No AI draft batches.",
    sourceChannelMcp: "ChatGPT connector",
    sourceChannelWeb: "Vakwen web",
    selectBatch: "Select an AI draft batch to review.",
    draftBatchFallback: "AI draft batch",
    rowsLabel: "rows",
    unsupportedLabel: "unsupported",
    statusLabel: "status",
    versionLabel: "version",
    connectorLabel: "connector",
    rowsPosted: "rows posted",
    exclude: "Exclude",
    reinclude: "Reinclude",
    reject: "Reject",
    archive: "Archive",
    delete: "Delete",
    rowsExcluded: "Rows excluded.",
    rowsReincluded: "Rows re-included.",
    rowsRejected: "Rows rejected.",
    batchArchived: "Batch archived.",
    batchDeleted: "Batch deleted.",
    connectorProvenance: "Connector provenance",
    connectorProvenanceMcp: "Vakwen received structured candidates, capped snippets, row mappings, and source metadata only from the ChatGPT connector.",
    connectorProvenanceWeb: "This batch was created in Vakwen and follows the same deterministic draft validation path.",
    sourceLabel: "Source label",
    sourceLabelFallback: "not provided",
    sourceSnippetsCapped: "Source snippets stay capped at 500 characters per row.",
    openDeepLink: "Open deep link",
    auditNote: "Canonical posting path and audit remain in Vakwen.",
    readyRowsSelected: "ready rows selected",
    typedConfirmation: "Typed confirmation",
    postSelected: "Post selected",
    rowsPostedMessage: "Rows posted.",
    twdGross: "TWD gross",
    unsupportedRows: "Unsupported rows",
    unsupportedRowsDescription: "non-trade rows were preserved for review.",
    rowLabel: "Row",
    tableStatus: "Status",
    tableTrade: "Trade",
    tableAccount: "Account",
    tableGross: "Gross",
    tableFees: "Fees",
    tableIssues: "Issues",
    tableEdit: "Edit",
    calculatedFees: "calculated",
    editRow: "Edit row",
    close: "Close",
    rowSaved: "Row saved.",
    saveRow: "Save row",
    version: "Version",
    account: "Account",
    type: "Type",
    ticker: "Ticker",
    market: "Market",
    quantity: "Quantity",
    unitPrice: "Unit price",
    currency: "Currency",
    tradeDate: "Trade date",
    timestamp: "Timestamp",
    sequence: "Sequence",
    commission: "Commission",
    tax: "Tax",
    dayTrade: "Day trade",
    unset: "Unset",
    no: "No",
    yes: "Yes",
    note: "Note",
    sourceSnippet: "Source snippet",
    validationDetails: "Validation details",
    archiveConfirm: "Archive this AI draft batch?",
    deleteConfirm: "Delete this AI draft batch? Unposted rows will be removed.",
    notProvided: "not provided",
    ariaSelectRow: "Select draft row",
    postedTransactionDeleted: "Posted transaction deleted",
  },
  "zh-TW": {
    title: "AI Inbox",
    openBatches: "個開啟批次",
    ready: "筆可送出",
    needsReview: "筆待檢查",
    refresh: "重新整理",
    loadError: "無法載入 AI Inbox。",
    actionError: "AI Inbox 操作失敗。",
    draftBatches: "草稿批次",
    loadingBatches: "正在載入批次...",
    noBatches: "目前沒有 AI 草稿批次。",
    sourceChannelMcp: "ChatGPT 連接器",
    sourceChannelWeb: "Vakwen 網頁",
    selectBatch: "請選取要檢查的 AI 草稿批次。",
    draftBatchFallback: "AI 草稿批次",
    rowsLabel: "筆資料列",
    unsupportedLabel: "不支援",
    statusLabel: "狀態",
    versionLabel: "版本",
    connectorLabel: "連接器",
    rowsPosted: "筆已送出",
    exclude: "排除",
    reinclude: "重新納入",
    reject: "拒絕",
    archive: "封存",
    delete: "刪除",
    rowsExcluded: "已排除資料列。",
    rowsReincluded: "已重新納入資料列。",
    rowsRejected: "已拒絕資料列。",
    batchArchived: "已封存批次。",
    batchDeleted: "已刪除批次。",
    connectorProvenance: "連接器來源",
    connectorProvenanceMcp: "Vakwen 只從 ChatGPT 連接器接收結構化候選資料、截斷片段、資料列對應與來源中繼資料。",
    connectorProvenanceWeb: "此批次是在 Vakwen 內建立，並遵循相同的確定性草稿驗證流程。",
    sourceLabel: "來源標籤",
    sourceLabelFallback: "未提供",
    sourceSnippetsCapped: "每筆資料列的來源片段最多保留 500 個字元。",
    openDeepLink: "開啟深層連結",
    auditNote: "正式送出路徑與稽核紀錄仍保留在 Vakwen。",
    readyRowsSelected: "筆可送出資料列已選取",
    typedConfirmation: "輸入確認字串",
    postSelected: "送出所選項目",
    rowsPostedMessage: "已送出資料列。",
    twdGross: "TWD 總額",
    unsupportedRows: "不支援的資料列",
    unsupportedRowsDescription: "筆非交易資料列已保留供檢查。",
    rowLabel: "資料列",
    tableStatus: "狀態",
    tableTrade: "交易",
    tableAccount: "帳戶",
    tableGross: "總額",
    tableFees: "費用",
    tableIssues: "問題",
    tableEdit: "編輯",
    calculatedFees: "系統計算",
    editRow: "編輯資料列",
    close: "關閉",
    rowSaved: "已儲存資料列。",
    saveRow: "儲存資料列",
    version: "版本",
    account: "帳戶",
    type: "類型",
    ticker: "代號",
    market: "市場",
    quantity: "數量",
    unitPrice: "單價",
    currency: "幣別",
    tradeDate: "交易日期",
    timestamp: "時間戳記",
    sequence: "排序",
    commission: "手續費",
    tax: "稅額",
    dayTrade: "當沖",
    unset: "未設定",
    no: "否",
    yes: "是",
    note: "備註",
    sourceSnippet: "來源片段",
    validationDetails: "驗證細節",
    archiveConfirm: "要封存這個 AI 草稿批次嗎？",
    deleteConfirm: "要刪除這個 AI 草稿批次嗎？未送出的資料列將一併移除。",
    notProvided: "未提供",
    ariaSelectRow: "選取草稿資料列",
    postedTransactionDeleted: "已刪除已送出交易",
  },
};
