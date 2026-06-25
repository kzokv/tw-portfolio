"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, RotateCcw, Search } from "lucide-react";
import type {
  AiConnectorAccessKind,
  AiConnectorAccessLogDto,
  AiConnectorConnectionDto,
  AiConnectorScope,
  AiConnectorToolCatalogEntryDto,
  AiConnectorToolGroup,
} from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import { useOptionalAppShellData } from "../layout/AppShellDataContext";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/shadcn/tabs";
import {
  fetchAiConnectorLogs,
  fetchAiConnectorSummary,
  revokeAiConnector,
  updateAiConnector,
  type AiConnectorSummaryResponse,
} from "../../features/ai-inbox/service";
import { getAiConnectorScopeLabel } from "../connectors/i18n";

type AiConnectorTab = "connections" | "tools" | "access";
type ToolGroupFilter = "all" | AiConnectorToolGroup;
type ToolAvailabilityFilter = "all" | AiConnectorToolCatalogEntryDto["availability"];

const GROUPED_SCOPES: Array<{ title: string; scopes: AiConnectorScope[] }> = [
  { title: "read", scopes: ["portfolio:mcp_read"] },
  { title: "accounts", scopes: ["account:manage"] },
  { title: "drafts", scopes: ["transaction_draft:create", "transaction_draft:edit", "transaction_draft:archive", "transaction_draft:delete"] },
  { title: "posting", scopes: ["transaction:write"] },
];

const CHATGPT_RECONNECT_URL = "https://chatgpt.com/";

const COPY = {
  en: {
    pageEyebrow: "AI settings",
    pageTitle: "AI Connectors",
    pageDescription: "Review MCP connections, manage tool access, and inspect recent connector activity.",
    refresh: "Refresh",
    policyTitle: "Policy and status",
    deployment: "Deployment",
    activeCap: "Active cap",
    inactivityExpiry: "Inactivity expiry",
    expiryWarning: "Expiry warning",
    policyAlert: "Admin policy has disabled all MCP tool groups. Connector permissions cannot be changed until at least one tool group is re-enabled.",
    connections: "Connections",
    tools: "MCP Tools",
    access: "Access Log",
    mobileTabLabel: "Section",
    activeConnections: "Active and pending connections",
    inactiveConnections: "Revoked or expired",
    inactiveCollapsed: "Hidden by default to keep the current ChatGPT connector in focus.",
    noConnections: "No AI connectors are connected yet.",
    noConnectionsBody: "Start a connector flow from ChatGPT, then return here to review status and access controls.",
    loadingConnections: "Loading connectors...",
    reconnectTitle: "Need fresh auth or expanded consent?",
    reconnectBody: "Reconnect in ChatGPT to grant missing account-management or posting scopes.",
    reconnect: "Reconnect in ChatGPT",
    revoke: "Revoke",
    recentAccess: "Recent access",
    loadingAccess: "Loading recent access...",
    noAccess: "No recent connector access recorded.",
    toolsTitle: "MCP tool controls",
    toolsDescription: "Search the shared tool catalog and manage per-connector overrides from one place.",
    toolSearchLabel: "Search tools",
    toolSearchPlaceholder: "Search tool name, description, or scope",
    toolGroupFilterLabel: "Tool group",
    toolAvailabilityFilterLabel: "Availability",
    filterAll: "All",
    noMatchingTools: "No tools match the current search.",
    inheritedDefault: "Inherited default",
    connectorOverride: "Connector override",
    unavailable: "Unavailable",
    available: "Available",
    currentFirstHint: "Current ChatGPT connections stay visible here; revoked and expired entries move below.",
    pendingStatus: "Waiting for ChatGPT to exchange the authorization code.",
    permissionSaved: "Connector permissions saved.",
    toolSaved: "Tool toggle saved.",
    connectorRevoked: "Connector revoked.",
    loadError: "AI connector settings could not be loaded.",
    updateError: "Connector update failed.",
    revokeError: "Connector revoke failed.",
    toolError: "Tool toggle update failed.",
    revokeConfirm: "Revoke {name}?",
    activeLastUsed: "Last used {time}",
    activeExpires: "Expires {time}",
    never: "Never",
    providerLabel: "Provider",
    groupedRead: "Read",
    groupedAccounts: "Accounts",
    groupedDrafts: "Drafts",
    groupedPosting: "Posting",
    toolGroupRead: "Read tools",
    toolGroupDrafts: "Draft tools",
    toolGroupWrite: "Write tools",
    accessRead: "Read",
    accessWrite: "Write",
    accessDraftCreate: "Draft create",
    accessDraftUpdate: "Draft update",
    accessDraftArchive: "Draft archive",
    accessDraftDelete: "Draft delete",
    disabledByPolicy: "Disabled by MCP policy",
    postingNotice: "`transaction:write` stays off by default. Use ChatGPT consent or reconnect to request it again.",
    requiresScope: "Requires {scope}.",
    connectorInactive: "Connector is {status}; only active connectors can call tools.",
    draftGroupDisabled: "Draft tools are disabled by policy.",
    reconnectPostingScope: "Reconnect or re-consent in ChatGPT to enable posting.",
    reconnectAccountManageScope: "Reconnect or re-consent in ChatGPT to enable account management tools.",
    daySuffix: " days",
    historyLabel: "{count} hidden connection(s)",
  },
  "zh-TW": {
    pageEyebrow: "AI 設定",
    pageTitle: "AI 連接器",
    pageDescription: "檢視 MCP 連線、管理工具存取，並查看最近的連接器活動。",
    refresh: "重新整理",
    policyTitle: "策略與狀態",
    deployment: "部署",
    activeCap: "啟用上限",
    inactivityExpiry: "閒置到期",
    expiryWarning: "到期提醒",
    policyAlert: "管理員目前停用了所有 MCP 工具群組，需重新開啟至少一個群組後才能調整連接器權限。",
    connections: "連線",
    tools: "MCP 工具",
    access: "存取紀錄",
    mobileTabLabel: "區段",
    activeConnections: "啟用中與待完成連線",
    inactiveConnections: "已撤銷或已到期",
    inactiveCollapsed: "預設折疊，讓目前使用中的 ChatGPT 連接器保持在最前面。",
    noConnections: "目前沒有已連接的 AI 連接器。",
    noConnectionsBody: "請先從 ChatGPT 啟動連接流程，再回到此頁檢查狀態與存取控制。",
    loadingConnections: "正在載入連接器...",
    reconnectTitle: "需要重新授權或補充同意範圍？",
    reconnectBody: "請在 ChatGPT 重新連線，以補齊帳戶管理或交易送出權限。",
    reconnect: "前往 ChatGPT 重新連線",
    revoke: "撤銷",
    recentAccess: "最近存取",
    loadingAccess: "正在載入最近存取紀錄...",
    noAccess: "最近沒有連接器存取紀錄。",
    toolsTitle: "MCP 工具控制",
    toolsDescription: "在同一個工具目錄中搜尋，並管理各連接器的覆寫設定。",
    toolSearchLabel: "搜尋工具",
    toolSearchPlaceholder: "搜尋工具名稱、說明或權限範圍",
    toolGroupFilterLabel: "工具群組",
    toolAvailabilityFilterLabel: "可用狀態",
    filterAll: "全部",
    noMatchingTools: "目前搜尋條件沒有符合的工具。",
    inheritedDefault: "沿用預設",
    connectorOverride: "連接器覆寫",
    unavailable: "不可用",
    available: "可用",
    currentFirstHint: "目前的 ChatGPT 連線會固定顯示在此；已撤銷與已到期項目會移到下方。",
    pendingStatus: "等待 ChatGPT 完成授權碼交換。",
    permissionSaved: "已儲存連接器權限。",
    toolSaved: "已儲存工具切換。",
    connectorRevoked: "已撤銷連接器。",
    loadError: "無法載入 AI 連接器設定。",
    updateError: "連接器更新失敗。",
    revokeError: "撤銷連接器失敗。",
    toolError: "工具切換更新失敗。",
    revokeConfirm: "要撤銷 {name} 嗎？",
    activeLastUsed: "上次使用 {time}",
    activeExpires: "到期時間 {time}",
    never: "從未",
    providerLabel: "提供者",
    groupedRead: "讀取",
    groupedAccounts: "帳戶",
    groupedDrafts: "草稿",
    groupedPosting: "送出",
    toolGroupRead: "讀取工具",
    toolGroupDrafts: "草稿工具",
    toolGroupWrite: "寫入工具",
    accessRead: "讀取",
    accessWrite: "寫入",
    accessDraftCreate: "建立草稿",
    accessDraftUpdate: "更新草稿",
    accessDraftArchive: "封存草稿",
    accessDraftDelete: "刪除草稿",
    disabledByPolicy: "已被 MCP 策略停用",
    postingNotice: "`transaction:write` 預設維持關閉。若要再次申請，請透過 ChatGPT 同意或重新連線。",
    requiresScope: "需要 {scope}。",
    connectorInactive: "連接器狀態為 {status}；只有啟用中的連接器可以呼叫工具。",
    draftGroupDisabled: "草稿工具已被策略停用。",
    reconnectPostingScope: "此範圍需在 ChatGPT 重新同意後啟用。",
    reconnectAccountManageScope: "請在 ChatGPT 重新連線或重新同意後啟用帳戶管理工具。",
    daySuffix: " 天",
    historyLabel: "隱藏 {count} 個歷史連線",
  },
} as const;

type LocalizedCopy = (typeof COPY)[keyof typeof COPY];

function statusClassName(status: AiConnectorConnectionDto["status"]): string {
  if (status === "pending") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "expired") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function toolAvailabilityClassName(tool: AiConnectorToolCatalogEntryDto): string {
  return tool.availability === "available"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-800";
}

function formatTime(value: string | null, fallback: string): string {
  return value ? new Date(value).toLocaleString() : fallback;
}

function policyValue(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined) return "-";
  return `${value}${suffix}`;
}

function groupToolCatalog(
  tools: AiConnectorToolCatalogEntryDto[] | undefined,
): Record<AiConnectorToolGroup, AiConnectorToolCatalogEntryDto[]> {
  return {
    read: tools?.filter((tool) => tool.group === "read") ?? [],
    drafts: tools?.filter((tool) => tool.group === "drafts") ?? [],
    write: tools?.filter((tool) => tool.group === "write") ?? [],
  };
}

function canConnectionUseTool(connection: AiConnectorConnectionDto, tool: AiConnectorToolCatalogEntryDto): boolean {
  return connection.scopes.includes(tool.scope);
}

function toolToggleChecked(connection: AiConnectorConnectionDto, tool: AiConnectorToolCatalogEntryDto): boolean {
  return tool.availability === "available" && canConnectionUseTool(connection, tool) && connection.toolToggles[tool.name] !== false;
}

function toolGroupLabel(copy: LocalizedCopy, group: AiConnectorToolGroup): string {
  if (group === "read") return copy.toolGroupRead;
  if (group === "drafts") return copy.toolGroupDrafts;
  return copy.toolGroupWrite;
}

function accessKindLabel(copy: LocalizedCopy, kind: AiConnectorAccessKind): string {
  if (kind === "read") return copy.accessRead;
  if (kind === "write") return copy.accessWrite;
  if (kind === "draft_create") return copy.accessDraftCreate;
  if (kind === "draft_update") return copy.accessDraftUpdate;
  if (kind === "draft_archive") return copy.accessDraftArchive;
  return copy.accessDraftDelete;
}

function scopeNeedsReconnect(connection: AiConnectorConnectionDto, scope: AiConnectorScope): boolean {
  return (scope === "transaction:write" || scope === "account:manage")
    && connection.provider === "chatgpt"
    && !connection.scopes.includes(scope);
}

function reconnectCopy(locale: keyof typeof COPY, scope: AiConnectorScope): string {
  return scope === "transaction:write"
    ? COPY[locale].reconnectPostingScope
    : COPY[locale].reconnectAccountManageScope;
}

function toolUnavailableReason(
  locale: keyof typeof COPY,
  connection: AiConnectorConnectionDto,
  tool: AiConnectorToolCatalogEntryDto,
): string | null {
  if (tool.unavailableReason) return tool.unavailableReason;
  if (connection.status !== "active") {
    return formatMessage(COPY[locale].connectorInactive, { status: connection.status });
  }
  if (!canConnectionUseTool(connection, tool)) {
    return formatMessage(COPY[locale].requiresScope, { scope: getAiConnectorScopeLabel(locale, tool.scope) });
  }
  return null;
}

function sortConnections(connections: AiConnectorConnectionDto[]): AiConnectorConnectionDto[] {
  const rank = (connection: AiConnectorConnectionDto): number => {
    if (connection.provider === "chatgpt" && connection.status === "active") return 0;
    if (connection.status === "active") return 1;
    if (connection.status === "pending") return 2;
    if (connection.status === "expired") return 3;
    return 4;
  };
  return [...connections].sort((left, right) => {
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) return rankDiff;
    return (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt);
  });
}

function formatMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
}

export function AiConnectorsSettingsClient() {
  const shellData = useOptionalAppShellData();
  const locale = shellData?.locale === "zh-TW" ? "zh-TW" : "en";
  const copy = COPY[locale];
  const [data, setData] = useState<AiConnectorSummaryResponse | null>(null);
  const [accessLogs, setAccessLogs] = useState<AiConnectorAccessLogDto[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [activeTab, setActiveTab] = useState<AiConnectorTab>("connections");
  const [toolSearch, setToolSearch] = useState("");
  const [toolGroupFilter, setToolGroupFilter] = useState<ToolGroupFilter>("all");
  const [toolAvailabilityFilter, setToolAvailabilityFilter] = useState<ToolAvailabilityFilter>("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsLoadingLogs(true);
    setError("");
    try {
      const [summary, logs] = await Promise.all([
        fetchAiConnectorSummary(),
        fetchAiConnectorLogs(12).catch(() => ({ accessLogs: [] })),
      ]);
      setData(summary);
      setAccessLogs(logs.accessLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
      setAccessLogs([]);
    } finally {
      setIsLoading(false);
      setIsLoadingLogs(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const connections = useMemo(
    () => sortConnections(data?.connections ?? []),
    [data?.connections],
  );
  const currentConnections = connections.filter((connection) => connection.status === "active" || connection.status === "pending");
  const historicalConnections = connections.filter((connection) => connection.status === "expired" || connection.status === "revoked");
  const groupedTools = groupToolCatalog(data?.toolCatalog);
  const filteredToolGroups = useMemo(() => {
    const query = toolSearch.trim().toLowerCase();
    const filterTools = (group: AiConnectorToolGroup) => groupedTools[group].filter((tool) => {
      if (toolGroupFilter !== "all" && tool.group !== toolGroupFilter) return false;
      if (toolAvailabilityFilter !== "all" && tool.availability !== toolAvailabilityFilter) return false;
      if (!query) return true;
      return tool.name.toLowerCase().includes(query)
        || tool.description.toLowerCase().includes(query)
        || getAiConnectorScopeLabel(locale, tool.scope).toLowerCase().includes(query);
    });
    return {
      read: filterTools("read"),
      drafts: filterTools("drafts"),
      write: filterTools("write"),
    };
  }, [groupedTools, locale, toolAvailabilityFilter, toolGroupFilter, toolSearch]);

  const scopeEnabledByGroup = useMemo(() => ({
    read: data?.policy.groupToggles.read ?? false,
    drafts: data?.policy.groupToggles.drafts ?? false,
    write: data?.policy.groupToggles.write ?? false,
  }), [data]);

  const allScopeGroupsDisabled = data !== null
    && !scopeEnabledByGroup.read
    && !scopeEnabledByGroup.drafts
    && !scopeEnabledByGroup.write;

  async function toggleScope(connection: AiConnectorConnectionDto, scope: AiConnectorScope, checked: boolean) {
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const nextScopes = checked
        ? [...new Set([...connection.scopes, scope])]
        : connection.scopes.filter((item) => item !== scope);
      const updated = await updateAiConnector(connection.id, { scopes: nextScopes });
      setData((current) => current ? {
        ...current,
        connections: current.connections.map((item) => item.id === updated.id ? updated : item),
      } : current);
      setMessage(copy.permissionSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.updateError);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTool(connection: AiConnectorConnectionDto, toolName: string, checked: boolean) {
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const updated = await updateAiConnector(connection.id, {
        toolToggles: { ...connection.toolToggles, [toolName]: checked },
      });
      setData((current) => current ? {
        ...current,
        connections: current.connections.map((item) => item.id === updated.id ? updated : item),
      } : current);
      setMessage(copy.toolSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.toolError);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(connection: AiConnectorConnectionDto) {
    if (!window.confirm(formatMessage(copy.revokeConfirm, { name: connection.displayName }))) return;
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const updated = await revokeAiConnector(connection.id);
      setData((current) => current ? {
        ...current,
        connections: current.connections.map((item) => item.id === updated.id ? updated : item),
      } : current);
      setMessage(copy.connectorRevoked);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.revokeError);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5" data-testid="settings-ai-connectors-page">
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:rounded-[1.75rem] sm:px-5 sm:py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{copy.pageEyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground break-words">{copy.pageTitle}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.pageDescription}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={isLoading} className="w-full sm:w-auto">
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {copy.refresh}
        </Button>
      </div>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      <Card className="rounded-xl sm:rounded-[1.5rem]">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{copy.policyTitle}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <CompactPolicyStat label={copy.deployment} value={data ? data.policy.enabled ? copy.available : copy.unavailable : "-"} />
            <CompactPolicyStat label={copy.activeCap} value={policyValue(data?.policy.maxActiveConnectionsPerUser)} />
            <CompactPolicyStat label={copy.inactivityExpiry} value={policyValue(data?.policy.inactivityExpiryDays, copy.daySuffix)} />
            <CompactPolicyStat label={copy.expiryWarning} value={policyValue(data?.policy.expirationWarningDays, copy.daySuffix)} />
          </div>
        </div>
      </Card>

      {allScopeGroupsDisabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          {copy.policyAlert}
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AiConnectorTab)} className="space-y-4">
        <div className="sm:hidden">
          <div className="mb-1 text-xs font-medium text-muted-foreground">{copy.mobileTabLabel}</div>
          <Select value={activeTab} onValueChange={(value) => setActiveTab(value as AiConnectorTab)}>
            <SelectTrigger data-testid="ai-connectors-mobile-tab-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="connections">{copy.connections}</SelectItem>
              <SelectItem value="tools">{copy.tools}</SelectItem>
              <SelectItem value="access">{copy.access}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TabsList className="hidden w-full grid-cols-3 sm:grid">
          <TabsTrigger value="connections" onClick={() => setActiveTab("connections")} data-testid="ai-connectors-tab-connections">{copy.connections}</TabsTrigger>
          <TabsTrigger value="tools" onClick={() => setActiveTab("tools")} data-testid="ai-connectors-tab-tools">{copy.tools}</TabsTrigger>
          <TabsTrigger value="access" onClick={() => setActiveTab("access")} data-testid="ai-connectors-tab-access">{copy.access}</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-4">
          {isLoading ? (
            <Card className="rounded-xl sm:rounded-[1.5rem]" role="status" aria-live="polite" aria-busy="true">
              <p className="text-sm text-muted-foreground">{copy.loadingConnections}</p>
            </Card>
          ) : currentConnections.length === 0 && historicalConnections.length === 0 ? (
            <Card className="rounded-xl border-dashed sm:rounded-[1.5rem]">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{copy.noConnections}</p>
                <p className="text-sm text-muted-foreground">{copy.noConnectionsBody}</p>
              </div>
            </Card>
          ) : (
            <>
              <Card className="rounded-xl sm:rounded-[1.5rem]">
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-foreground">{copy.activeConnections}</h2>
                  <p className="text-sm text-muted-foreground">{copy.currentFirstHint}</p>
                </div>
              </Card>
              {currentConnections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  busy={busyId === connection.id}
                  connection={connection}
                  copy={copy}
                  locale={locale}
                  onRevoke={() => void revoke(connection)}
                  onToggleScope={(scope, checked) => void toggleScope(connection, scope, checked)}
                  scopeEnabledByGroup={scopeEnabledByGroup}
                />
              ))}
              {historicalConnections.length > 0 ? (
                <details className="rounded-xl border border-border bg-card px-4 py-4 sm:rounded-[1.5rem] sm:px-5" data-testid="ai-connectors-history">
                  <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                    {formatMessage(copy.historyLabel, { count: String(historicalConnections.length) })}
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">{copy.inactiveCollapsed}</p>
                  <div className="mt-4 space-y-4">
                    {historicalConnections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        busy={busyId === connection.id}
                        connection={connection}
                        copy={copy}
                        locale={locale}
                        onRevoke={() => void revoke(connection)}
                        onToggleScope={(scope, checked) => void toggleScope(connection, scope, checked)}
                        scopeEnabledByGroup={scopeEnabledByGroup}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="tools" className="space-y-4">
          <Card className="rounded-xl sm:rounded-[1.5rem]">
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">{copy.toolsTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.toolsDescription}</p>
              </div>
              <label className="relative block">
                <span className="sr-only">{copy.toolSearchLabel}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={toolSearch}
                  onChange={(event) => setToolSearch(event.target.value)}
                  placeholder={copy.toolSearchPlaceholder}
                  className="pl-9"
                  data-testid="ai-connectors-tool-search"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>{copy.toolGroupFilterLabel}</span>
                  <select
                    value={toolGroupFilter}
                    onChange={(event) => setToolGroupFilter(event.target.value as ToolGroupFilter)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    data-testid="ai-connectors-tool-group-filter"
                  >
                    <option value="all">{copy.filterAll}</option>
                    <option value="read">{copy.toolGroupRead}</option>
                    <option value="drafts">{copy.toolGroupDrafts}</option>
                    <option value="write">{copy.toolGroupWrite}</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>{copy.toolAvailabilityFilterLabel}</span>
                  <select
                    value={toolAvailabilityFilter}
                    onChange={(event) => setToolAvailabilityFilter(event.target.value as ToolAvailabilityFilter)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    data-testid="ai-connectors-tool-availability-filter"
                  >
                    <option value="all">{copy.filterAll}</option>
                    <option value="available">{copy.available}</option>
                    <option value="unavailable">{copy.unavailable}</option>
                  </select>
                </label>
              </div>
            </div>
          </Card>
          {connections.length === 0 ? (
            <Card className="rounded-xl border-dashed sm:rounded-[1.5rem]">
              <p className="text-sm text-muted-foreground">{copy.noConnectionsBody}</p>
            </Card>
          ) : (
            connections.map((connection) => (
              <ToolSurfaceCard
                key={`tools-${connection.id}`}
                busy={busyId === connection.id}
                connection={connection}
                copy={copy}
                locale={locale}
                onToggle={(toolName, checked) => void toggleTool(connection, toolName, checked)}
                tools={filteredToolGroups}
              />
            ))
          )}
          {Object.values(filteredToolGroups).every((group) => group.length === 0) ? (
            <Card className="rounded-xl border-dashed sm:rounded-[1.5rem]">
              <p className="text-sm text-muted-foreground">{copy.noMatchingTools}</p>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          {isLoadingLogs ? (
            <Card className="rounded-xl sm:rounded-[1.5rem]" role="status" aria-live="polite" aria-busy="true">
              <p className="text-sm text-muted-foreground">{copy.loadingAccess}</p>
            </Card>
          ) : accessLogs.length > 0 ? (
            <Card className="rounded-xl sm:rounded-[1.5rem]">
              <h2 className="text-base font-semibold text-foreground">{copy.recentAccess}</h2>
              <div className="mt-3 divide-y divide-border">
                {accessLogs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium text-foreground">{log.toolName}</span>
                    <span className="text-muted-foreground">{log.accessKind} · {log.result} · {new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="rounded-xl border-dashed sm:rounded-[1.5rem]">
              <p className="text-sm text-muted-foreground">{copy.noAccess}</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CompactPolicyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/20 px-4 py-3 sm:rounded-2xl">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium text-foreground">{value}</p>
    </div>
  );
}

function ConnectionCard({
  busy,
  connection,
  copy,
  locale,
  onRevoke,
  onToggleScope,
  scopeEnabledByGroup,
}: {
  busy: boolean;
  connection: AiConnectorConnectionDto;
  copy: LocalizedCopy;
  locale: keyof typeof COPY;
  onRevoke: () => void;
  onToggleScope: (scope: AiConnectorScope, checked: boolean) => void;
  scopeEnabledByGroup: { read: boolean; drafts: boolean; write: boolean };
}) {
  return (
    <Card className="rounded-xl sm:rounded-[1.5rem]" data-testid={`ai-connector-${connection.id}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-lg font-semibold text-foreground">{connection.displayName}</h2>
            <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
              {connection.status}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {copy.providerLabel}: {connection.provider}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{formatMessage(copy.activeLastUsed, { time: formatTime(connection.lastUsedAt, copy.never) })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatMessage(copy.activeExpires, { time: formatTime(connection.expiresAt, copy.never) })}</p>
          {connection.status === "pending" ? (
            <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700" role="status" aria-live="polite">
              {copy.pendingStatus}
            </p>
          ) : null}
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={onRevoke}
          disabled={busy || connection.status === "revoked"}
          className="w-full lg:w-auto"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          {copy.revoke}
        </Button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {GROUPED_SCOPES.map((group) => (
          <ScopeGroupCard
            key={group.title}
            connection={connection}
            copy={copy}
            locale={locale}
            onToggleScope={onToggleScope}
            scopeEnabledByGroup={scopeEnabledByGroup}
            title={group.title}
            scopes={group.scopes}
            busy={busy}
          />
        ))}
      </div>

      {connection.provider === "chatgpt" ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:rounded-2xl">
          <span className="min-w-0 flex-1">
            <span className="font-medium text-foreground">{copy.reconnectTitle}</span>
            <span className="ml-2">{copy.reconnectBody}</span>
          </span>
          <a
            href={CHATGPT_RECONNECT_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-900 transition hover:border-slate-400 sm:w-auto"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {copy.reconnect}
          </a>
        </div>
      ) : null}
    </Card>
  );
}

function ScopeGroupCard({
  busy,
  connection,
  copy,
  locale,
  onToggleScope,
  scopeEnabledByGroup,
  title,
  scopes,
}: {
  busy: boolean;
  connection: AiConnectorConnectionDto;
  copy: LocalizedCopy;
  locale: keyof typeof COPY;
  onToggleScope: (scope: AiConnectorScope, checked: boolean) => void;
  scopeEnabledByGroup: { read: boolean; drafts: boolean; write: boolean };
  title: string;
  scopes: AiConnectorScope[];
}) {
  const titleMap = {
    read: copy.groupedRead,
    accounts: copy.groupedAccounts,
    drafts: copy.groupedDrafts,
    posting: copy.groupedPosting,
  };

  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/20 p-3 sm:rounded-2xl sm:p-4">
      <p className="text-sm font-medium text-foreground">{titleMap[title as keyof typeof titleMap]}</p>
      <div className="mt-3 space-y-2">
        {scopes.map((scope) => {
          const policyDisabled =
            (scope === "portfolio:mcp_read" && !scopeEnabledByGroup.read)
            || (scope === "account:manage" && !scopeEnabledByGroup.write)
            || (scope.startsWith("transaction_draft") && !scopeEnabledByGroup.drafts)
            || (scope === "transaction:write" && !scopeEnabledByGroup.write);
          const reconnectRequired = scopeNeedsReconnect(connection, scope);
          const disabled = busy || connection.status !== "active" || policyDisabled || reconnectRequired;
          return (
            <label key={scope} className="flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-background/80">
              <span className="min-w-0 break-words">
                {getAiConnectorScopeLabel(locale, scope)}
                {policyDisabled ? (
                  <span className="block text-xs text-slate-500">{copy.disabledByPolicy}</span>
                ) : null}
                {reconnectRequired ? (
                  <span className="mt-1 block text-xs text-amber-700">{reconnectCopy(locale, scope)}</span>
                ) : null}
              </span>
              <input
                type="checkbox"
                checked={connection.scopes.includes(scope)}
                disabled={disabled}
                onChange={(event) => onToggleScope(scope, event.target.checked)}
              />
            </label>
          );
        })}
      </div>
      {title === "posting" ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          {copy.postingNotice}
        </div>
      ) : null}
    </div>
  );
}

function ToolSurfaceCard({
  busy,
  connection,
  copy,
  locale,
  onToggle,
  tools,
}: {
  busy: boolean;
  connection: AiConnectorConnectionDto;
  copy: LocalizedCopy;
  locale: keyof typeof COPY;
  onToggle: (toolName: string, checked: boolean) => void;
  tools: Record<AiConnectorToolGroup, AiConnectorToolCatalogEntryDto[]>;
}) {
  const toolCount = Object.values(tools).reduce((sum, group) => sum + group.length, 0);
  if (toolCount === 0) return null;

  return (
    <Card className="rounded-xl sm:rounded-[1.5rem]" data-testid={`ai-connector-tools-${connection.id}`}>
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-foreground">{connection.displayName}</h3>
          <p className="text-sm text-muted-foreground">{connection.provider} · {connection.status}</p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
          {connection.status}
        </span>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {(Object.keys(tools) as AiConnectorToolGroup[]).map((group) => (
          <div key={group} className="min-w-0 rounded-xl border border-border bg-muted/20 p-3 sm:rounded-2xl sm:p-4">
            <p className="text-sm font-medium text-foreground">{toolGroupLabel(copy, group)}</p>
            <div className="mt-3 flex flex-col gap-2">
              {tools[group].map((tool) => {
                const unavailableReason = toolUnavailableReason(locale, connection, tool);
                const explicit = Object.prototype.hasOwnProperty.call(connection.toolToggles, tool.name);
                return (
                  <label key={`${connection.id}-${tool.name}`} className="block rounded-xl border border-border bg-background px-3 py-3 text-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 break-all font-mono font-medium text-foreground">{tool.name}</span>
                          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", toolAvailabilityClassName(tool))}>
                            {tool.availability === "available" ? copy.available : copy.unavailable}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">{tool.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{getAiConnectorScopeLabel(locale, tool.scope)}</span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{accessKindLabel(copy, tool.accessKind)}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {unavailableReason ?? (explicit ? copy.connectorOverride : copy.inheritedDefault)}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={toolToggleChecked(connection, tool)}
                        disabled={busy || unavailableReason !== null}
                        onChange={(event) => onToggle(tool.name, event.target.checked)}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
