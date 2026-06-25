import type { AiConnectorScope, LocaleCode } from "@vakwen/shared-types";

export const aiConnectorScopeLabels: Record<LocaleCode, Record<AiConnectorScope, string>> = {
  en: {
    "portfolio:mcp_read": "Read portfolio data",
    "account:manage": "Manage accounts",
    "transaction_draft:create": "Create transaction drafts",
    "transaction_draft:edit": "Edit transaction drafts",
    "transaction_draft:archive": "Archive transaction drafts",
    "transaction_draft:delete": "Delete transaction drafts",
    "transaction:write": "Post confirmed transactions",
  },
  "zh-TW": {
    "portfolio:mcp_read": "讀取投資組合資料",
    "account:manage": "管理帳戶",
    "transaction_draft:create": "建立交易草稿",
    "transaction_draft:edit": "編輯交易草稿",
    "transaction_draft:archive": "封存交易草稿",
    "transaction_draft:delete": "刪除交易草稿",
    "transaction:write": "送出已確認交易",
  },
};

export const chatGptConnectorAuthorizeCopy: Record<LocaleCode, {
  title: string;
  description: string;
  client: string;
  resource: string;
  redirect: string;
  permissions: string;
  connectorLifetime: string;
  connectorApprovalBusy: string;
  connectorDenialBusy: string;
  retryRequest: string;
  startAgainInChatGpt: string;
  loadingRequest: string;
  approve: string;
  approving: string;
  deny: string;
  missingRequestError: string;
  loadError: string;
  approveError: string;
  denyError: string;
  policyDisabled: string;
  disabledByPolicy: string;
  advancedScope: string;
  postingOptIn: string;
  requiresManageReconsent: string;
}> = {
  en: {
    title: "Connect ChatGPT",
    description: "Authorize ChatGPT to use Vakwen MCP tools for your account.",
    client: "Client",
    resource: "MCP resource",
    redirect: "Redirect",
    permissions: "Permissions",
    connectorLifetime: "Connector lifetime",
    connectorApprovalBusy: "Approving connector request",
    connectorDenialBusy: "Denying connector request",
    retryRequest: "Retry request",
    startAgainInChatGpt: "Start again in ChatGPT",
    loadingRequest: "Loading authorization request...",
    approve: "Approve",
    approving: "Approving...",
    deny: "Deny",
    missingRequestError: "Connector authorization request could not be loaded.",
    loadError: "Connector authorization request could not be loaded.",
    approveError: "Connector approval failed.",
    denyError: "Connector denial failed.",
    policyDisabled: "Admin policy has disabled every requested MCP tool group. Deny this request or ask an admin to re-enable at least one MCP tool group before approving.",
    disabledByPolicy: "Disabled by admin policy",
    advancedScope: "Advanced scope. Off by default and requires fresh auth or re-consent to grant.",
    postingOptIn: "Posting is an advanced opt-in. Leave it unchecked unless you want ChatGPT to call the guarded `post_transaction_draft_rows` tool after typed or explicit confirmation.",
    requiresManageReconsent: "Reconnect in ChatGPT and grant `account:manage` before this widget can create or change accounts.",
  },
  "zh-TW": {
    title: "連接 ChatGPT",
    description: "授權 ChatGPT 使用你帳戶的 Vakwen MCP 工具。",
    client: "Client",
    resource: "MCP 資源",
    redirect: "重新導向",
    permissions: "權限",
    connectorLifetime: "連接器有效天數",
    connectorApprovalBusy: "正在核准連接器請求",
    connectorDenialBusy: "正在拒絕連接器請求",
    retryRequest: "重試請求",
    startAgainInChatGpt: "回到 ChatGPT 重新開始",
    loadingRequest: "正在載入授權請求...",
    approve: "核准",
    approving: "核准中...",
    deny: "拒絕",
    missingRequestError: "無法載入連接器授權請求。",
    loadError: "無法載入連接器授權請求。",
    approveError: "連接器核准失敗。",
    denyError: "連接器拒絕失敗。",
    policyDisabled: "管理員策略已停用所有要求的 MCP 工具群組。請拒絕此請求，或先請管理員重新啟用至少一個 MCP 工具群組後再核准。",
    disabledByPolicy: "已被管理員策略停用",
    advancedScope: "進階權限。預設關閉，需重新授權或重新同意後才能啟用。",
    postingOptIn: "交易送出屬於進階自選權限。除非你希望 ChatGPT 在明確或輸入確認後呼叫受保護的 `post_transaction_draft_rows` 工具，否則請保持未勾選。",
    requiresManageReconsent: "請在 ChatGPT 重新連線並授權 `account:manage`，此元件才能建立或修改帳戶。",
  },
};

export function getAiConnectorScopeLabel(locale: LocaleCode, scope: AiConnectorScope): string {
  return aiConnectorScopeLabels[locale][scope];
}
