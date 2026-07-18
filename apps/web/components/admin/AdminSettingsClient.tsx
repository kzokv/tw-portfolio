"use client";

// KZO-198 — Repair cooldown bounds, like every other Tier 1 numeric knob,
// flow from `apps/api/src/services/appConfig/bounds.ts` → DTO → UI. The
// `NumericOverrideRow` component reads `min`/`max` from `config.bounds`
// directly; no module-level constants are duplicated in this file.

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  Copy,
  Database,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Link2,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  type AiConnectorPolicySettingsDto,
  type AiConnectorReadinessCheckKey,
  type AppConfigDto,
  type MarketCode,
  type RouteCachePolicyMode,
  type TickerPriceFreshnessAppConfigDto,
  type TickerPriceFreshnessYahooChartInterval,
  type TickerPriceFreshnessYahooChartRange,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  dashboardPerformanceRangesSchema,
} from "@vakwen/shared-types";
import { getJson, patchJson, postJson, ApiError } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from "../ui/Tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import { Switch } from "../ui/shadcn/switch";
import { SortableRangeList, type SortableRangeRow } from "../settings/SortableRangeList";
import { NumericOverrideRow } from "./NumericOverrideRow";
import { MaskedSecretInput } from "./MaskedSecretInput";
import { useAdminI18n } from "./admin-i18n";
import { McpStatusChip, mcpStatusTone } from "../connectors/McpUiPrimitives";
import { TooltipInfo } from "../ui/TooltipInfo";
import {
  AiClientGlyph,
  type CompatibleAiClientKind,
} from "../connectors/clientMetadata";

// KZO-199 — locked tab structure. Architect-design.md §0:
//   admin-settings-tabs                  — list container
//   admin-settings-tab-{slug}            — trigger
//   admin-settings-panel-{slug}          — panel
const TAB_SLUGS = [
  "rate-limits",
  "sharing",
  "provider-health",
  "backfill-repair",
  "catalog-metadata",
  "display-defaults",
  "api-keys",
  "mcp",
] as const;
type TabSlug = (typeof TAB_SLUGS)[number];
const DEFAULT_TAB: TabSlug = "rate-limits";
const ROUTE_CACHE_POLICY_DEFAULT_SELECT_VALUE = "__effective_policy";

const TAB_LABELS: Record<TabSlug, string> = {
  "rate-limits": "Rate limits",
  "sharing": "Sharing",
  "provider-health": "Provider operations",
  "backfill-repair": "Backfill & repair",
  "catalog-metadata": "Catalog & metadata",
  "display-defaults": "Display defaults",
  "api-keys": "API keys",
  "mcp": "MCP",
};

const TAB_DESCRIPTIONS: Record<TabSlug, string> = {
  "rate-limits": "Traffic windows, budgets, and request throttles.",
  "sharing": "Public-link caps and anonymous share guardrails.",
  "provider-health": "Guardrails, operation pacing, health thresholds, and retention.",
  "backfill-repair": "Repair retries and backfill pacing defaults.",
  "catalog-metadata": "Catalog absence thresholds and metadata enrichment mode.",
  "display-defaults": "New-account display defaults and dashboard timeframes.",
  "api-keys": "Encrypted provider secrets stored in app config.",
  "mcp": "Global AI connector policy and OAuth redirect allowlist.",
};

const TAB_NAV_ITEMS: Array<{
  slug: TabSlug;
  icon: LucideIcon;
  hint: string;
}> = [
  { slug: "rate-limits", icon: Gauge, hint: "Traffic controls" },
  { slug: "sharing", icon: Link2, hint: "Public access" },
  { slug: "provider-health", icon: Activity, hint: "Provider operations" },
  { slug: "backfill-repair", icon: Wrench, hint: "Worker pacing" },
  { slug: "catalog-metadata", icon: Database, hint: "Catalog policy" },
  { slug: "display-defaults", icon: LayoutDashboard, hint: "User defaults" },
  { slug: "api-keys", icon: KeyRound, hint: "Provider secrets" },
  { slug: "mcp", icon: Bot, hint: "AI connector policy" },
];

const ADMIN_SETTINGS_ZH: Record<string, string> = {
  "Rate limits": "速率限制",
  "Sharing": "分享",
  "Provider health": "資料提供者健康度",
  "Backfill & repair": "回補與修復",
  "Catalog & metadata": "目錄與中繼資料",
  "Display defaults": "顯示預設值",
  "API keys": "API 金鑰",
  "MCP": "MCP",
  "Traffic windows, budgets, and request throttles.": "流量視窗、配額與請求節流。",
  "Public-link caps and anonymous share guardrails.": "公開連結上限與匿名分享防護。",
  "Provider cooldowns, retention, and alert suppression.": "資料提供者冷卻時間、保留期限與警示抑制。",
  "Guardrails, operation pacing, health thresholds, and retention.": "防護、作業節奏、健康門檻與保留期限。",
  "Repair retries and backfill pacing defaults.": "修復重試與回補節奏預設值。",
  "Catalog absence thresholds and metadata enrichment mode.": "目錄缺席門檻與中繼資料補全模式。",
  "New-account display defaults and dashboard timeframes.": "新帳戶顯示預設值與儀表板時間範圍。",
  "Encrypted provider secrets stored in app config.": "儲存在應用設定中的加密資料提供者密鑰。",
  "Global AI connector policy and OAuth redirect allowlist.": "全域 AI 連接器政策與 OAuth 重新導向允許清單。",
  "Traffic controls": "流量控制",
  "Public access": "公開存取",
  "Provider operations": "資料提供者作業",
  "Worker pacing": "背景工作節奏",
  "Catalog policy": "目錄政策",
  "User defaults": "使用者預設",
  "Provider secrets": "資料提供者密鑰",
  "AI connector policy": "AI 連接器政策",
  "Posted transaction mutations": "已入帳交易異動",
  "Maximum transactions per batch": "每批交易上限",
  "Default 50 · Effective {value} · No platform hard cap": "預設 50 · 實際 {value} · 平台沒有硬上限",
  "Values above 200 are still allowed, but can cause large MCP payload or response failures, preview or client timeouts, longer account locks and revision conflicts, rebuild queue backlogs, or a client timeout after the server has already committed.": "超過 200 的值仍可儲存，但可能造成大型 MCP 請求或回應失敗、預覽或客戶端逾時、較長的帳戶鎖定與版本衝突、重建佇列壅塞，或伺服器已提交後客戶端才逾時。",
  "Batch limit guidance": "批次上限說明",
  "Settings": "設定",
  "Runtime configuration. Changes apply immediately and are recorded in the audit log.": "執行階段設定。變更會立即生效並記錄到稽核記錄。",
  "Admin settings sections": "管理設定區段",
  "Open": "開啟",
  "Section": "區段",
  "Per-IP rate-limiter windows and request budgets. Empty override → fall back to environment value.": "每個 IP 的速率限制視窗與請求配額。覆寫留空時會回退使用環境值。",
  "Market data price · window": "市場資料價格 · 視窗",
  "Market data price · limit": "市場資料價格 · 上限",
  "Market data search · window": "市場資料搜尋 · 視窗",
  "Market data search · limit": "市場資料搜尋 · 上限",
  "Invite status · window": "邀請狀態 · 視窗",
  "Invite status · limit": "邀請狀態 · 上限",
  "Anonymous-share-token cap and per-IP rate limits. Off = use the environment default.": "匿名分享權杖上限與每個 IP 的速率限制。關閉時使用環境預設值。",
  "Anonymous share token cap": "匿名分享權杖上限",
  "Maximum active anonymous share tokens per owner. New token requests above this fail with cap-exceeded.": "每位擁有者可啟用的匿名分享權杖上限。超過上限的新權杖請求會以 cap-exceeded 失敗。",
  "Anonymous share rate limit · max": "匿名分享速率限制 · 最大值",
  "Maximum requests per window for anonymous-share endpoints (per IP).": "匿名分享端點每個視窗的最大請求數（每個 IP）。",
  "Anonymous share rate limit · window": "匿名分享速率限制 · 視窗",
  "Sliding-window length for the anonymous-share rate limiter.": "匿名分享速率限制器的滑動視窗長度。",
  "Notification suppression, error-trail retention, and re-run cooldown for the provider health surface.": "資料提供者健康度頁面的通知抑制、錯誤軌跡保留期限與重新執行冷卻時間。",
  "Down notification suppression": "故障通知抑制",
  "Cooldown between repeat 'provider down' notifications for the same provider+market.": "相同資料提供者與市場重複發送「提供者故障」通知之間的冷卻時間。",
  "Error trail retention": "錯誤軌跡保留",
  "Days of historical provider errors to keep before the purge cron evicts them.": "提供者歷史錯誤在清除排程移除前保留的天數。",
  "Re-run cooldown": "重新執行冷卻時間",
  "Minimum interval between admin-triggered re-runs for the same provider+market.": "管理員對相同資料提供者與市場觸發重新執行的最小間隔。",
  "Yahoo Finance AU re-run cooldown": "Yahoo Finance 澳洲重新執行冷卻時間",
  "Yahoo-AU-specific override for the re-run cooldown. Falls back to the generic re-run cooldown when off.": "Yahoo 澳洲專用的重新執行冷卻時間覆寫。關閉時回退使用一般重新執行冷卻時間。",
  "Provider operations guardrails": "資料提供者作業防護",
  "Dangerous match threshold": "危險批次門檻",
  "Operations at or above this match count require typed confirmation before execution.": "達到或超過此符合數量的作業，在執行前必須輸入確認文字。",
  "Preview sample limit": "預覽樣本上限",
  "Maximum evidence rows captured in a provider operation preview.": "資料提供者作業預覽中最多擷取的證據列數。",
  "Provider operations page size": "資料提供者作業頁面大小",
  "Default page size for provider operation, log, and evidence tables.": "資料提供者作業、記錄與證據表格的預設頁面大小。",
  "Auto-pause failures per minute": "每分鐘自動暫停失敗數",
  "Failure rate that auto-pauses a running provider operation.": "正在執行的資料提供者作業達到此失敗率時會自動暫停。",
  "Preview token TTL": "預覽權杖有效時間",
  "Minutes before a provider operation preview token expires.": "資料提供者作業預覽權杖到期前的分鐘數。",
  "Provider operation automation": "資料提供者作業自動化",
  "Auto-renew interval": "自動更新間隔",
  "Cadence for refreshing unresolved evidence without writing mappings or bars.": "刷新未解決證據的頻率，不會寫入映射或價格列。",
  "Incident recurrence window": "事件重複歸併視窗",
  "Repeated provider errors inside this window update the existing incident instead of creating a new one.": "此視窗內重複的資料提供者錯誤會更新既有事件，而不是建立新事件。",
  "Provider health thresholds": "資料提供者健康門檻",
  "Warning unresolved threshold": "警告未解決門檻",
  "Active unresolved item count that moves provider health to warning.": "使資料提供者健康度進入警告狀態的啟用中未解決項目數。",
  "Critical unresolved threshold": "嚴重未解決門檻",
  "Active unresolved item count that moves provider health to critical. Must stay above the warning threshold.": "使資料提供者健康度進入嚴重狀態的啟用中未解決項目數。必須高於警告門檻。",
  "Stale operation heartbeat": "作業心跳逾時",
  "Running operation age without progress before it is treated as stale in the admin console.": "執行中作業未進展多久後，在管理主控台中視為過期。",
  "Provider retention": "資料提供者保留期限",
  "Operation summary retention": "作業摘要保留",
  "Days to keep completed provider operation summaries before retention cleanup.": "保留已完成資料提供者作業摘要的天數，之後由保留清理移除。",
  "Operation log retention": "作業記錄保留",
  "Days to keep provider operation logs before retention cleanup or guarded purge.": "保留資料提供者作業記錄的天數，之後由保留清理或受防護清除移除。",
  "Incident retention": "事件保留",
  "Days to keep resolved or ignored provider incidents.": "保留已解決或已忽略資料提供者事件的天數。",
  "Resolved item retention": "已解決項目保留",
  "Days to keep resolved unresolved-item records for audit and recently resolved views.": "為稽核與最近已解決檢視保留已解決未解決項目記錄的天數。",
  "Provider operation budgets": "資料提供者作業配額",
  "FinMind shared hourly cap": "FinMind 共用每小時上限",
  "Shared TW/US provider budget. Must stay below the configured upstream FinMind budget.": "TW/US 共用資料提供者配額。必須低於已設定的 FinMind 上游配額。",
  "Twelve Data shared per-minute cap": "Twelve Data 共用每分鐘上限",
  "Shared AU/KR catalog budget. Must stay below the configured upstream Twelve Data budget.": "AU/KR 目錄共用配額。必須低於已設定的 Twelve Data 上游配額。",
  "Yahoo AU per-minute cap": "Yahoo 澳洲每分鐘上限",
  "Yahoo Finance AU operation budget. Must stay below the configured upstream budget.": "Yahoo Finance 澳洲作業配額。必須低於已設定的上游配額。",
  "Yahoo KR per-minute cap": "Yahoo 韓國每分鐘上限",
  "Yahoo Finance KR operation budget. Must stay below the configured upstream budget.": "Yahoo Finance 韓國作業配額。必須低於已設定的上游配額。",
  "Frankfurter per-minute cap": "Frankfurter 每分鐘上限",
  "Frankfurter FX refresh operation budget. Must stay below the configured provider ceiling.": "Frankfurter 匯率更新作業配額。必須低於已設定的資料提供者上限。",
	  "ASX GICS hourly cap": "ASX GICS 每小時上限",
	  "ASX GICS CSV refresh pacing. Must stay below the configured provider ceiling.": "ASX GICS CSV 更新節奏。必須低於已設定的資料提供者上限。",
	  "Provider pacing": "資料提供者請求節奏",
	  "Minimum spacing between provider requests. Null uses the default; 0 disables spacing.": "資料提供者請求之間的最小間隔。空值使用預設值；0 會停用間隔。",
	  "FinMind minimum request interval": "FinMind 最小請求間隔",
	  "Configured for TW/US market-data provider pacing. Enforcement is not active in this PR.": "用於 TW/US 市場資料提供者請求節奏。本 PR 尚未啟用強制套用。",
	  "Twelve Data minimum request interval": "Twelve Data 最小請求間隔",
	  "Configured for AU/KR catalog pacing. Enforcement is not active in this PR.": "用於 AU/KR 目錄請求節奏。本 PR 尚未啟用強制套用。",
	  "Yahoo AU minimum request interval": "Yahoo AU 最小請求間隔",
	  "Configured for Yahoo Finance AU pacing. Enforcement is not active in this PR.": "用於 Yahoo Finance AU 請求節奏。本 PR 尚未啟用強制套用。",
	  "Yahoo KR minimum request interval": "Yahoo KR 最小請求間隔",
	  "Configured for Yahoo Finance KR pacing. Enforcement is active in this PR.": "用於 Yahoo Finance KR 請求節奏。本 PR 已啟用強制套用。",
	  "Frankfurter minimum request interval": "Frankfurter 最小請求間隔",
	  "Configured for FX refresh pacing. Enforcement is not active in this PR.": "用於 FX 匯率更新請求節奏。本 PR 尚未啟用強制套用。",
	  "ASX GICS minimum request interval": "ASX GICS 最小請求間隔",
	  "Configured for ASX GICS refresh pacing. Enforcement is not active in this PR.": "用於 ASX GICS 更新請求節奏。本 PR 尚未啟用強制套用。",
	  "Configured only": "僅可設定",
	  "Enforced now": "目前已強制套用",
	  "Status": "狀態",
	  "Repair cooldown": "修復冷卻時間",
  "Minimum wait time (in minutes) between repair runs for the same symbol. Off = use the environment default.": "同一代號兩次修復之間的最短等待時間（分鐘）。關閉時使用環境預設值。",
  "Cooldown": "冷卻時間",
  "Backfill": "回補",
  "Retry budget and rate-limit backoff for the FinMind/Yahoo backfill worker.": "FinMind/Yahoo 回補背景工作的重試配額與限流退避設定。",
  "Retry limit": "重試上限",
  "Maximum pg-boss retry attempts per backfill job before it is marked failed.": "每個回補工作被標記失敗前的最大 pg-boss 重試次數。",
  "Retry delay": "重試延遲",
  "Base backoff between failed retries. The reschedule path additionally honours provider Retry-After.": "失敗重試之間的基礎退避時間。重新排程路徑也會遵守提供者的 Retry-After。",
  "FinMind 402 retry": "FinMind 402 重試",
  "Pause window after FinMind returns HTTP 402 (quota exceeded) before resuming the queue.": "FinMind 回傳 HTTP 402（配額用盡）後，恢復佇列前的暫停時間。",
  "Absence-based delisting detection": "基於缺席的下市偵測",
  "Thresholds that govern when a catalog instrument is auto-flagged as delisted. Off = use the environment defaults.": "控制目錄標的何時自動標記為下市的門檻。關閉時使用環境預設值。",
  "Absence threshold": "缺席門檻",
  "Number of consecutive catalog-sync runs an instrument must be absent before being flagged delisted.": "標的必須連續缺席多少次目錄同步才會被標記為下市。",
  "Absence guard · percent": "缺席防護 · 百分比",
  "Reject a catalog-sync diff that would mark more than this percent of the universe absent in a single run.": "拒絕單次同步中將超過此百分比標的標記為缺席的目錄差異。",
  "Absence guard · floor": "缺席防護 · 最低列數",
  "Minimum absent-row count below which the percent guard does not engage (small universes are forgiving).": "低於此缺席列數時不啟用百分比防護（小型標的池較寬鬆）。",
  "Metadata enrichment mode": "中繼資料補全模式",
  "Mode": "模式",
  "Use environment default": "使用環境預設值",
  "Always enrich (unconditional)": "一律補全（無條件）",
  "Skip on daily refresh (conditional)": "每日更新時略過（條件式）",
  "Effective:": "實際值：",
  "(env default)": "（環境預設）",
  "(admin override)": "（管理覆寫）",
  "Dashboard Timeframe Defaults": "儀表板時間範圍預設值",
  "Users can override these defaults in their own Display Preferences.": "使用者可在自己的顯示偏好中覆寫這些預設值。",
  "Active timeframes": "啟用中的時間範圍",
  "No active timeframes — add at least one.": "沒有啟用中的時間範圍，請至少新增一個。",
  "Available": "可用",
  "Add custom range": "新增自訂範圍",
  "Add": "新增",
  "Format:": "格式：",
  "Reset to defaults": "重設為預設值",
  "Provider API keys": "資料提供者 API 金鑰",
  "Encrypted secrets stored in": "加密密鑰儲存在",
  ". Existing values are never displayed; rotate to replace, clear to fall back to the environment value. Audit log records the rotation event but never the secret.": "。現有值永不顯示；可透過輪替替換，或清除以回退使用環境值。稽核記錄只記錄輪替事件，不記錄密鑰本身。",
  "FinMind API token": "FinMind API 權杖",
  "Bearer token used by the TWSE/FinMind data provider.": "TWSE/FinMind 資料提供者使用的 Bearer 權杖。",
  "Twelve Data API key": "Twelve Data API 金鑰",
  "API key used by the AU catalog (Twelve Data) provider.": "澳洲目錄（Twelve Data）資料提供者使用的 API 金鑰。",
  "EODHD API key": "EODHD API 金鑰",
  "API key used by the EODHD end-of-day fallback provider.": "EODHD 收盤備援提供者使用的 API 金鑰。",
  "EODHD fallback budget": "EODHD 備援配額",
  "Strict local guard for scheduled and manual fallback refreshes.": "排程與手動備援刷新的本地嚴格防護。",
  "EODHD daily call limit": "EODHD 每日呼叫上限",
  "Maximum EODHD calls the app may spend per day before refreshes are blocked locally.": "應用程式每天可使用的 EODHD 最大呼叫數；超過後會在本地封鎖刷新。",
  "Last updated": "最後更新",
  "· Change will be recorded in the audit log": "· 變更將記錄到稽核記錄",
};

function translateAdminSettingsCopy(isZhTW: boolean, text: string): string {
  return isZhTW ? ADMIN_SETTINGS_ZH[text] ?? text : text;
}

function isValidTabSlug(value: string | null): value is TabSlug {
  return value !== null && (TAB_SLUGS as readonly string[]).includes(value);
}

interface AdminSettingsClientProps {
  initial: AppConfigDto;
}

type McpNumericSettingKey =
  | "maxActiveConnectionsPerUser"
  | "inactivityExpiryDays"
  | "expirationWarningDays"
  | "maxConnectorLifetimeDays"
  | "postedTransactionMutationBatchLimit";

const MCP_NUMERIC_FIELDS: Array<{
  key: McpNumericSettingKey;
  label: string;
  min: number;
  max?: number;
}> = [
  { key: "maxActiveConnectionsPerUser", label: "Max active connectors", min: 1, max: 20 },
  { key: "inactivityExpiryDays", label: "Inactivity expiry days", min: 1, max: 365 },
  { key: "expirationWarningDays", label: "Expiry warning days", min: 1, max: 30 },
  { key: "maxConnectorLifetimeDays", label: "Max connector lifetime days", min: 1, max: 365 },
  { key: "postedTransactionMutationBatchLimit", label: "Maximum transactions per batch", min: 1 },
];

function numericDraftsFromSettings(
  settings: AiConnectorPolicySettingsDto,
): Record<McpNumericSettingKey, string> {
  return {
    maxActiveConnectionsPerUser: String(settings.maxActiveConnectionsPerUser),
    inactivityExpiryDays: String(settings.inactivityExpiryDays),
    expirationWarningDays: String(settings.expirationWarningDays),
    maxConnectorLifetimeDays: String(settings.maxConnectorLifetimeDays),
    postedTransactionMutationBatchLimit: String(settings.postedTransactionMutationBatchLimit),
  };
}

function parseMcpNumericDrafts(
  drafts: Record<McpNumericSettingKey, string>,
): Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey> {
  return Object.fromEntries(MCP_NUMERIC_FIELDS.map((field) => {
    const value = Number(drafts[field.key]);
    if (!Number.isInteger(value) || value < field.min || (field.max !== undefined && value > field.max)) {
      throw new Error(
        field.max !== undefined
          ? `${field.label} must be an integer from ${field.min} to ${field.max}.`
          : `${field.label} must be a positive integer.`,
      );
    }
    return [field.key, value];
  })) as Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey>;
}

const MCP_BUILT_IN_REDIRECT_ALLOWLIST_EXAMPLES = [
  "https://chatgpt.com/connector/oauth/<connector-id>",
  "https://chat.openai.com/connector/oauth/<connector-id>",
  "https://chatgpt.com/aip/oauth/callback",
  "https://chatgpt.com/aip/<gpt-id>/oauth/callback",
] as const;
const CLAUDE_AI_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

function redirectAllowlistDraftFromSettings(settings: AiConnectorPolicySettingsDto): string {
  return settings.oauthRedirectUriAllowlist.join("\n");
}

function parseRedirectAllowlistDraft(draft: string): string[] {
  const values = draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized: string[] = [];
  for (const value of values) {
    if (value.includes("<") || value.includes(">")) {
      throw new Error("Replace example placeholders before saving redirect URIs.");
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Each redirect URI must be a valid URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname === "/") {
      throw new Error("Each redirect URI must be an exact HTTPS path URL without query or hash.");
    }
    normalized.push(url.toString());
  }
  return [...new Set(normalized)];
}

function generateHexSecret(bytes = 32): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random generation is unavailable in this browser.");
  }
  const values = new Uint8Array(bytes);
  cryptoApi.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

const MCP_CLIENT_ROWS: Array<{
  key: CompatibleAiClientKind;
  label: string;
  vendor: string;
  tier: "Tier 1" | "Tier 2";
}> = [
  { key: "chatgpt_app", label: "ChatGPT / OpenAI Apps", vendor: "OpenAI", tier: "Tier 1" },
  { key: "claude_ai_connector", label: "Claude.ai", vendor: "Anthropic", tier: "Tier 1" },
  { key: "claude_code", label: "Claude Code", vendor: "Anthropic", tier: "Tier 1" },
  { key: "codex_cli", label: "Codex CLI / IDE", vendor: "OpenAI Codex", tier: "Tier 1" },
  { key: "gemini_cli", label: "Gemini CLI", vendor: "Google", tier: "Tier 2" },
  { key: "copilot_mcp", label: "VS Code / Copilot MCP", vendor: "Microsoft", tier: "Tier 2" },
  { key: "generic_mcp", label: "Generic MCP", vendor: "Generic", tier: "Tier 2" },
];

function allowedClientKindsRecord(settings: AiConnectorPolicySettingsDto): Record<string, boolean> {
  return settings.allowedClientKinds as Record<string, boolean>;
}

function mcpReadinessStatusLabel(status: AiConnectorPolicySettingsDto["readiness"]["status"], isZhTW: boolean): string {
  if (status === "ready") return isZhTW ? "就緒" : "Ready";
  if (status === "degraded") return isZhTW ? "需注意" : "Needs attention";
  return isZhTW ? "停用" : "Disabled";
}

function mcpReadinessCheckLabel(key: AiConnectorReadinessCheckKey, isZhTW: boolean): string {
  if (key === "deployment") return isZhTW ? "部署" : "Deployment";
  if (key === "public_issuer") return isZhTW ? "公開發行者" : "Public issuer";
  if (key === "oauth_token_secret") return isZhTW ? "OAuth 密鑰" : "OAuth secret";
  if (key === "mcp_url") return "MCP URL";
  if (key === "client_kind_policy") return isZhTW ? "客戶端策略" : "Client policy";
  if (key === "high_risk_tools") return isZhTW ? "送出與維護工具群組" : "Posting and maintenance groups";
  return isZhTW ? "Bearer 備援" : "Bearer fallback";
}

const DEFAULT_TICKER_PRICE_FRESHNESS_SETTINGS: TickerPriceFreshnessAppConfigDto = {
  closeRefreshGraceMinutes: null,
  effectiveCloseRefreshGraceMinutes: 30,
  intradayEnabled: null,
  effectiveIntradayEnabled: true,
  intradayRefreshIntervalMinutes: null,
  effectiveIntradayRefreshIntervalMinutes: 1,
  intradayFreshnessToleranceMinutes: null,
  effectiveIntradayFreshnessToleranceMinutes: 20,
  yahooChartRequestLimitPerMinute: null,
  effectiveYahooChartRequestLimitPerMinute: 30,
  queueConcurrency: null,
  effectiveQueueConcurrency: 2,
  maxTickersPerRefreshCycle: null,
  effectiveMaxTickersPerRefreshCycle: 100,
  supportedMarkets: null,
  effectiveSupportedMarkets: ["TW", "US", "AU", "KR", "JP"],
  regularSessionOnly: null,
  effectiveRegularSessionOnly: true,
  yahooChartRange: null,
  effectiveYahooChartRange: "1d",
  yahooChartInterval: null,
  effectiveYahooChartInterval: "1m",
  refreshCloseRateLimitWindowMs: null,
  effectiveRefreshCloseRateLimitWindowMs: 60_000,
  refreshCloseRateLimitMax: null,
  effectiveRefreshCloseRateLimitMax: 10,
  syncTickerCap: null,
  effectiveSyncTickerCap: 50,
  activityDetailedRetentionDays: null,
  effectiveActivityDetailedRetentionDays: 7,
  activitySummaryRetentionDays: null,
  effectiveActivitySummaryRetentionDays: 90,
  calendarHistoryRetentionDays: null,
  effectiveCalendarHistoryRetentionDays: 730,
  options: {
    supportedMarkets: ["TW", "US", "AU", "KR", "JP"],
    yahooChartRanges: ["1d", "5d"],
    yahooChartIntervals: ["1m", "2m", "5m", "15m"],
  },
  bounds: {
    closeRefreshGraceMinutes: { min: 0, max: 240 },
    intradayRefreshIntervalMinutes: { min: 1, max: 60 },
    intradayFreshnessToleranceMinutes: { min: 1, max: 240 },
    yahooChartRequestLimitPerMinute: { min: 1, max: 600 },
    queueConcurrency: { min: 1, max: 32 },
    maxTickersPerRefreshCycle: { min: 1, max: 1000 },
    refreshCloseRateLimitWindowMs: { min: 1000, max: 600000 },
    refreshCloseRateLimitMax: { min: 1, max: 1000 },
    syncTickerCap: { min: 1, max: 1000 },
    activityDetailedRetentionDays: { min: 1, max: 365 },
    activitySummaryRetentionDays: { min: 1, max: 730 },
    calendarHistoryRetentionDays: { min: 30, max: 3650 },
  },
};

type TickerPriceFreshnessPatchDto = Pick<
  TickerPriceFreshnessAppConfigDto,
  | "closeRefreshGraceMinutes"
  | "intradayEnabled"
  | "intradayRefreshIntervalMinutes"
  | "intradayFreshnessToleranceMinutes"
  | "yahooChartRequestLimitPerMinute"
  | "queueConcurrency"
  | "maxTickersPerRefreshCycle"
  | "supportedMarkets"
  | "regularSessionOnly"
  | "yahooChartRange"
  | "yahooChartInterval"
  | "refreshCloseRateLimitWindowMs"
  | "refreshCloseRateLimitMax"
  | "syncTickerCap"
  | "activityDetailedRetentionDays"
  | "activitySummaryRetentionDays"
  | "calendarHistoryRetentionDays"
>;

function formatTickerBooleanValue(value: boolean, isZhTW: boolean): string {
  if (isZhTW) return value ? "啟用" : "停用";
  return value ? "Enabled" : "Disabled";
}

function formatTickerListValue(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function TickerBooleanOverrideRow({
  fieldKey,
  label,
  description,
  override,
  effective,
  isZhTW,
  onSave,
}: {
  fieldKey: string;
  label: string;
  description: string;
  override: boolean | null;
  effective: boolean;
  isZhTW: boolean;
  onSave: (value: boolean | null) => Promise<void>;
}) {
  const dict = useAdminI18n();
  const [overrideEnabled, setOverrideEnabled] = useState(override !== null);
  const [selected, setSelected] = useState(override ?? effective);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setOverrideEnabled(override !== null);
    setSelected(override ?? effective);
  }, [effective, override]);

  function handleToggle(next: boolean) {
    setOverrideEnabled(next);
    setError(null);
    setSuccess(null);
    if (next) setSelected(override ?? effective);
  }

  async function dispatchSave(next: boolean | null) {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await onSave(next);
      setSuccess(dict.common.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.inputs.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  const testIdPrefix = `admin-settings-${fieldKey}`;

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0" data-testid={`${testIdPrefix}-row`}>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={overrideEnabled}
          onChange={(event) => handleToggle(event.target.checked)}
          disabled={saving}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
          data-testid={`${testIdPrefix}-toggle`}
        />
        <span className="text-sm font-medium text-slate-700">{dict.inputs.override}</span>
      </label>
      {overrideEnabled ? (
        <div className="flex flex-wrap gap-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={selected === value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium",
                selected === value ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-slate-700",
              )}
              onClick={() => {
                setSelected(value);
                setError(null);
                setSuccess(null);
              }}
              disabled={saving}
              data-testid={`${testIdPrefix}-option-${String(value)}`}
            >
              {formatTickerBooleanValue(value, isZhTW)}
            </button>
          ))}
        </div>
      ) : (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700" data-testid={`${testIdPrefix}-env-default-badge`}>
          {dict.inputs.usingEnvDefault} {formatTickerBooleanValue(effective, isZhTW)}
        </span>
      )}
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{success}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {override !== null ? (
          <Button variant="ghost" size="sm" onClick={() => void dispatchSave(null)} disabled={saving} data-testid={`${testIdPrefix}-reset-button`}>
            {dict.inputs.resetToDefault}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void dispatchSave(overrideEnabled ? selected : null)} disabled={saving} data-testid={`${testIdPrefix}-save-button`}>
          {saving ? dict.common.saving : dict.common.save}
        </Button>
      </div>
    </div>
  );
}

function TickerSelectOverrideRow<T extends string>({
  fieldKey,
  label,
  description,
  allowedValuesLabel,
  override,
  effective,
  options,
  onSave,
}: {
  fieldKey: string;
  label: string;
  description: string;
  allowedValuesLabel: string;
  override: T | null;
  effective: T;
  options: readonly T[];
  onSave: (value: T | null) => Promise<void>;
}) {
  const dict = useAdminI18n();
  const [overrideEnabled, setOverrideEnabled] = useState(override !== null);
  const [selected, setSelected] = useState<T>(override ?? effective);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setOverrideEnabled(override !== null);
    setSelected(override ?? effective);
  }, [effective, override]);

  async function dispatchSave(next: T | null) {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await onSave(next);
      setSuccess(dict.common.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.inputs.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  const testIdPrefix = `admin-settings-${fieldKey}`;

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0" data-testid={`${testIdPrefix}-row`}>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={overrideEnabled}
          onChange={(event) => {
            const next = event.target.checked;
            setOverrideEnabled(next);
            if (next) setSelected(override ?? effective);
            setError(null);
            setSuccess(null);
          }}
          disabled={saving}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
          data-testid={`${testIdPrefix}-toggle`}
        />
        <span className="text-sm font-medium text-slate-700">{dict.inputs.override}</span>
      </label>
      {overrideEnabled ? (
        <Select value={selected} onValueChange={(value) => {
          setSelected(value as T);
          setError(null);
          setSuccess(null);
        }}>
          <SelectTrigger className="w-44" data-testid={`${testIdPrefix}-select`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700" data-testid={`${testIdPrefix}-env-default-badge`}>
          {dict.inputs.usingEnvDefault} {effective}
        </span>
      )}
      <p className="text-xs text-slate-500">
        {allowedValuesLabel} {options.join(", ")}.
      </p>
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{success}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {override !== null ? (
          <Button variant="ghost" size="sm" onClick={() => void dispatchSave(null)} disabled={saving} data-testid={`${testIdPrefix}-reset-button`}>
            {dict.inputs.resetToDefault}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void dispatchSave(overrideEnabled ? selected : null)} disabled={saving} data-testid={`${testIdPrefix}-save-button`}>
          {saving ? dict.common.saving : dict.common.save}
        </Button>
      </div>
    </div>
  );
}

function TickerMarketListOverrideRow({
  fieldKey,
  label,
  description,
  allowedValuesLabel,
  override,
  effective,
  options,
  onSave,
}: {
  fieldKey: string;
  label: string;
  description: string;
  allowedValuesLabel: string;
  override: MarketCode[] | null;
  effective: MarketCode[];
  options: MarketCode[];
  onSave: (value: MarketCode[] | null) => Promise<void>;
}) {
  const dict = useAdminI18n();
  const [overrideEnabled, setOverrideEnabled] = useState(override !== null);
  const [selected, setSelected] = useState<MarketCode[]>(override ?? effective);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setOverrideEnabled(override !== null);
    setSelected(override ?? effective);
  }, [effective, override]);

  async function dispatchSave(next: MarketCode[] | null) {
    setError(null);
    setSuccess(null);
    if (next && next.length === 0) {
      setError(dict.inputs.selectAtLeastOneMarket);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setSuccess(dict.common.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.inputs.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  const testIdPrefix = `admin-settings-${fieldKey}`;

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0" data-testid={`${testIdPrefix}-row`}>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={overrideEnabled}
          onChange={(event) => {
            const next = event.target.checked;
            setOverrideEnabled(next);
            if (next) setSelected(override ?? effective);
            setError(null);
            setSuccess(null);
          }}
          disabled={saving}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
          data-testid={`${testIdPrefix}-toggle`}
        />
        <span className="text-sm font-medium text-slate-700">{dict.inputs.override}</span>
      </label>
      {overrideEnabled ? (
        <div className="flex flex-wrap gap-2">
          {options.map((market) => {
            const active = selected.includes(market);
            return (
              <button
                key={market}
                type="button"
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium",
                  active ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-slate-700",
                )}
                onClick={() => {
                  setSelected((current) => active ? current.filter((item) => item !== market) : [...current, market]);
                  setError(null);
                  setSuccess(null);
                }}
                disabled={saving}
                data-testid={`${testIdPrefix}-option-${market}`}
              >
                {market}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700" data-testid={`${testIdPrefix}-env-default-badge`}>
          {dict.inputs.usingEnvDefault} {formatTickerListValue(effective)}
        </span>
      )}
      <p className="text-xs text-slate-500">
        {allowedValuesLabel} {options.join(", ")}.
      </p>
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{success}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {override !== null ? (
          <Button variant="ghost" size="sm" onClick={() => void dispatchSave(null)} disabled={saving} data-testid={`${testIdPrefix}-reset-button`}>
            {dict.inputs.resetToDefault}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void dispatchSave(overrideEnabled ? selected : null)} disabled={saving || (overrideEnabled && selected.length === 0)} data-testid={`${testIdPrefix}-save-button`}>
          {saving ? dict.common.saving : dict.common.save}
        </Button>
      </div>
    </div>
  );
}

function TickerPriceFreshnessSettingsCard({
  config,
  isZhTW,
  onUpdated,
}: {
  config: AppConfigDto;
  isZhTW: boolean;
  onUpdated: (next: AppConfigDto) => void;
}) {
  const settings = config.tickerPriceFreshness ?? DEFAULT_TICKER_PRICE_FRESHNESS_SETTINGS;

  async function saveField<K extends keyof TickerPriceFreshnessPatchDto>(
    field: K,
    value: TickerPriceFreshnessPatchDto[K],
  ): Promise<void> {
    const patch = { [field]: value } as Partial<TickerPriceFreshnessPatchDto>;
    const updated = await patchJson<AppConfigDto>("/admin/settings", { tickerPriceFreshness: patch });
    onUpdated(updated);
  }

  return (
    <Card data-testid="admin-settings-ticker-price-freshness-section">
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{isZhTW ? "價格新鮮度" : "Ticker price freshness"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {isZhTW ? "把收盤刷新與盤中輪詢設定集中在同一個群組。" : "Group close-refresh and intraday freshness controls in one operator surface."}
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <NumericOverrideRow
            fieldKey="tickerPriceCloseRefreshGraceMinutes"
            label={isZhTW ? "收盤寬限（分鐘）" : "Close grace minutes"}
            description={isZhTW ? "市場收盤後等待多久才嘗試補齊當日收盤價。" : "Minutes to wait after market close before trying to fill the current daily close."}
            override={settings.closeRefreshGraceMinutes}
            effective={settings.effectiveCloseRefreshGraceMinutes}
            bounds={settings.bounds.closeRefreshGraceMinutes}
            unit="min"
            inputTestId="admin-settings-input-tickerPriceCloseRefreshGraceMinutes"
            onSave={(value) => saveField("closeRefreshGraceMinutes", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceSyncTickerCap"
            label={isZhTW ? "同步刷新上限" : "Sync ticker cap"}
            description={isZhTW ? "手動收盤刷新會同步處理的最大代號數，超出後排入背景佇列。" : "Maximum tickers a manual close refresh handles synchronously before queueing overflow."}
            override={settings.syncTickerCap}
            effective={settings.effectiveSyncTickerCap}
            bounds={settings.bounds.syncTickerCap}
            unit="tickers"
            inputTestId="admin-settings-input-tickerPriceSyncTickerCap"
            onSave={(value) => saveField("syncTickerCap", value)}
          />
          <TickerBooleanOverrideRow
            fieldKey="tickerPriceIntradayEnabled"
            label={isZhTW ? "啟用盤中刷新" : "Enable intraday refresh"}
            description={isZhTW ? "市場開盤時允許持倉代號使用 Yahoo 盤中覆蓋價格。" : "Allow held tickers to use Yahoo intraday overlay prices while their market is open."}
            override={settings.intradayEnabled}
            effective={settings.effectiveIntradayEnabled}
            isZhTW={isZhTW}
            onSave={(value) => saveField("intradayEnabled", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceIntradayRefreshIntervalMinutes"
            label={isZhTW ? "盤中刷新間隔（分鐘）" : "Intraday refresh interval"}
            description={isZhTW ? "前端靜默輪詢 API 的目標間隔；也用於判斷覆蓋價格是否需要排程更新。" : "Target silent polling interval for API refreshes and stale-overlay enqueue decisions."}
            override={settings.intradayRefreshIntervalMinutes}
            effective={settings.effectiveIntradayRefreshIntervalMinutes}
            bounds={settings.bounds.intradayRefreshIntervalMinutes}
            unit="min"
            inputTestId="admin-settings-input-tickerPriceIntradayRefreshIntervalMinutes"
            onSave={(value) => saveField("intradayRefreshIntervalMinutes", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceIntradayFreshnessToleranceMinutes"
            label={isZhTW ? "新鮮度容忍（分鐘）" : "Freshness tolerance"}
            description={isZhTW ? "Yahoo 盤中 bar 可被標示為即時更新的最大延遲；超過後顯示延遲狀態。" : "Maximum Yahoo intraday bar age shown as updated; older same-day bars display delayed state."}
            override={settings.intradayFreshnessToleranceMinutes}
            effective={settings.effectiveIntradayFreshnessToleranceMinutes}
            bounds={settings.bounds.intradayFreshnessToleranceMinutes}
            unit="min"
            inputTestId="admin-settings-input-tickerPriceIntradayFreshnessToleranceMinutes"
            onSave={(value) => saveField("intradayFreshnessToleranceMinutes", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceYahooChartRequestLimitPerMinute"
            label={isZhTW ? "Yahoo 每分鐘請求上限" : "Yahoo requests per minute"}
            description={isZhTW ? "盤中刷新 worker 對 Yahoo chart endpoint 的每分鐘請求預算。" : "Per-minute request budget for the intraday worker's Yahoo chart endpoint calls."}
            override={settings.yahooChartRequestLimitPerMinute}
            effective={settings.effectiveYahooChartRequestLimitPerMinute}
            bounds={settings.bounds.yahooChartRequestLimitPerMinute}
            unit="/min"
            inputTestId="admin-settings-input-tickerPriceYahooChartRequestLimitPerMinute"
            onSave={(value) => saveField("yahooChartRequestLimitPerMinute", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceQueueConcurrency"
            label={isZhTW ? "佇列並行數" : "Queue concurrency"}
            description={isZhTW ? "盤中價格刷新 worker 可同時處理的工作數。" : "Number of intraday price refresh jobs the worker may process concurrently."}
            override={settings.queueConcurrency}
            effective={settings.effectiveQueueConcurrency}
            bounds={settings.bounds.queueConcurrency}
            unit="jobs"
            inputTestId="admin-settings-input-tickerPriceQueueConcurrency"
            onSave={(value) => saveField("queueConcurrency", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceMaxTickersPerRefreshCycle"
            label={isZhTW ? "每輪最大代號數" : "Max tickers per cycle"}
            description={isZhTW ? "每次頁面讀取最多排入盤中刷新的持倉代號數。" : "Maximum held ticker-market pairs a demand-triggered page read may enqueue."}
            override={settings.maxTickersPerRefreshCycle}
            effective={settings.effectiveMaxTickersPerRefreshCycle}
            bounds={settings.bounds.maxTickersPerRefreshCycle}
            unit="tickers"
            inputTestId="admin-settings-input-tickerPriceMaxTickersPerRefreshCycle"
            onSave={(value) => saveField("maxTickersPerRefreshCycle", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceActivityDetailedRetentionDays"
            label={isZhTW ? "活動詳細保留天數" : "Activity detail retention"}
            description={isZhTW ? "保留盤中請求、延遲、錯誤與跳過事件明細的天數。" : "Days to keep detailed intraday request, delay, error, and skip Activity events."}
            override={settings.activityDetailedRetentionDays}
            effective={settings.effectiveActivityDetailedRetentionDays}
            bounds={settings.bounds.activityDetailedRetentionDays}
            unit="days"
            inputTestId="admin-settings-input-tickerPriceActivityDetailedRetentionDays"
            onSave={(value) => saveField("activityDetailedRetentionDays", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceActivitySummaryRetentionDays"
            label={isZhTW ? "活動摘要保留天數" : "Activity summary retention"}
            description={isZhTW ? "保留活動摘要與趨勢查詢可用資料的天數。" : "Days to keep Activity summaries and longer-window diagnostic counts."}
            override={settings.activitySummaryRetentionDays}
            effective={settings.effectiveActivitySummaryRetentionDays}
            bounds={settings.bounds.activitySummaryRetentionDays}
            unit="days"
            inputTestId="admin-settings-input-tickerPriceActivitySummaryRetentionDays"
            onSave={(value) => saveField("activitySummaryRetentionDays", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceCalendarHistoryRetentionDays"
            label={isZhTW ? "日曆歷史保留天數" : "Calendar history retention"}
            description={isZhTW ? "保留市場日曆匯入、替換與失效歷史的天數。" : "Days to keep calendar import, replacement, and invalidation history."}
            override={settings.calendarHistoryRetentionDays}
            effective={settings.effectiveCalendarHistoryRetentionDays}
            bounds={settings.bounds.calendarHistoryRetentionDays}
            unit="days"
            inputTestId="admin-settings-input-tickerPriceCalendarHistoryRetentionDays"
            onSave={(value) => saveField("calendarHistoryRetentionDays", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceRefreshCloseRateLimitWindowMs"
            label={isZhTW ? "刷新視窗（毫秒）" : "Refresh endpoint window"}
            description={isZhTW ? "手動收盤刷新 API 的使用者/IP 速率限制視窗。" : "User/IP rate-limit window for the manual close-refresh endpoint."}
            override={settings.refreshCloseRateLimitWindowMs}
            effective={settings.effectiveRefreshCloseRateLimitWindowMs}
            bounds={settings.bounds.refreshCloseRateLimitWindowMs}
            unit="ms"
            inputTestId="admin-settings-input-tickerPriceRefreshCloseRateLimitWindowMs"
            onSave={(value) => saveField("refreshCloseRateLimitWindowMs", value)}
          />
          <NumericOverrideRow
            fieldKey="tickerPriceRefreshCloseRateLimitMax"
            label={isZhTW ? "刷新請求上限" : "Refresh endpoint max requests"}
            description={isZhTW ? "每個速率限制視窗允許的手動收盤刷新請求數。" : "Maximum manual close-refresh requests allowed per rate-limit window."}
            override={settings.refreshCloseRateLimitMax}
            effective={settings.effectiveRefreshCloseRateLimitMax}
            bounds={settings.bounds.refreshCloseRateLimitMax}
            unit="requests"
            inputTestId="admin-settings-input-tickerPriceRefreshCloseRateLimitMax"
            onSave={(value) => saveField("refreshCloseRateLimitMax", value)}
          />
          <TickerBooleanOverrideRow
            fieldKey="tickerPriceRegularSessionOnly"
            label={isZhTW ? "僅常規時段" : "Regular session only"}
            description={isZhTW ? "只在常規現貨交易時段使用盤中覆蓋價格；盤前、盤後與競價不納入 MVP。" : "Use intraday overlay prices only during regular cash-market sessions; pre/post-market stays out of scope."}
            override={settings.regularSessionOnly}
            effective={settings.effectiveRegularSessionOnly}
            isZhTW={isZhTW}
            onSave={(value) => saveField("regularSessionOnly", value)}
          />
          <TickerSelectOverrideRow<TickerPriceFreshnessYahooChartRange>
            fieldKey="tickerPriceYahooChartRange"
            label={isZhTW ? "Yahoo chart range" : "Yahoo chart range"}
            description={isZhTW ? "Yahoo chart 查詢範圍；worker 會轉換成 SDK 支援的期間參數。" : "Yahoo chart lookup range; the worker translates this into SDK-compatible period options."}
            allowedValuesLabel={isZhTW ? "允許值：" : "Allowed values:"}
            override={settings.yahooChartRange}
            effective={settings.effectiveYahooChartRange}
            options={settings.options.yahooChartRanges}
            onSave={(value) => saveField("yahooChartRange", value)}
          />
          <TickerSelectOverrideRow<TickerPriceFreshnessYahooChartInterval>
            fieldKey="tickerPriceYahooChartInterval"
            label={isZhTW ? "Yahoo chart interval" : "Yahoo chart interval"}
            description={isZhTW ? "Yahoo chart bar 間隔；用於選取同一市場日期最新的非空 close。" : "Yahoo chart bar interval used to select the latest same-market-date non-null close."}
            allowedValuesLabel={isZhTW ? "允許值：" : "Allowed values:"}
            override={settings.yahooChartInterval}
            effective={settings.effectiveYahooChartInterval}
            options={settings.options.yahooChartIntervals}
            onSave={(value) => saveField("yahooChartInterval", value)}
          />
          <TickerMarketListOverrideRow
            fieldKey="tickerPriceSupportedMarkets"
            label={isZhTW ? "支援市場" : "Supported markets"}
            description={isZhTW ? "允許盤中覆蓋與收盤刷新規則作用的市場。" : "Markets eligible for intraday overlay and close-refresh freshness rules."}
            allowedValuesLabel={isZhTW ? "允許值：" : "Allowed values:"}
            override={settings.supportedMarkets}
            effective={settings.effectiveSupportedMarkets}
            options={settings.options.supportedMarkets}
            onSave={(value) => saveField("supportedMarkets", value)}
          />
        </div>
      </div>
    </Card>
  );
}

// KZO-159: Predefined chip palette for the Dashboard Timeframe Defaults section.
// `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` (4 items) is the fallback active selection;
// this 6-chip palette includes longer ranges that admins commonly toggle on.
const PREDEFINED_TIMEFRAME_CHIPS = ["1M", "3M", "YTD", "1Y", "5Y", "10Y"] as const;

// String-template i18n strings (per `.claude/rules/nextjs-i18n-serialization.md` —
// no functions in strings that may cross server→client boundaries).
const TIMEFRAME_HELPER_TEXT =
  "Users can override these defaults in their own Display Preferences.";
const TIMEFRAME_INVALID_FORMAT_MSG =
  "Invalid range format. Use e.g. 1M, 3M, 1Y, YTD, ALL.";
const TIMEFRAME_DUPLICATE_MSG = "That range is already in the list.";
const TIMEFRAME_EMPTY_LIST_MSG = "Add at least one timeframe.";
const TIMEFRAME_LIST_TOO_LONG_MSG = "Maximum 12 timeframes allowed.";

// Single-element validity check via the shared zod schema. Wrapping the
// candidate in a one-element array reuses the schema's element validator
// without duplicating the regex on the client (per design D9 — single
// source of truth for the range grammar).
function isValidPerformanceRange(value: string): boolean {
  return dashboardPerformanceRangesSchema.safeParse([value]).success;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function AdminMcpSettingsPanel({ active }: { active: boolean }) {
  const adminDict = useAdminI18n();
  const isZhTW = adminDict.common.justNow === "剛剛";
  const t = (text: string) => translateAdminSettingsCopy(isZhTW, text);
  const [settings, setSettings] = useState<AiConnectorPolicySettingsDto | null>(null);
  const [issuerDraft, setIssuerDraft] = useState("");
  const [redirectAllowlistDraft, setRedirectAllowlistDraft] = useState("");
  const [numericDrafts, setNumericDrafts] = useState<Record<McpNumericSettingKey, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!active || settings !== null) return;
    let cancelled = false;
    getJson<AiConnectorPolicySettingsDto>("/admin/mcp/settings")
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setIssuerDraft(next.oauthPublicIssuer ?? "");
          setRedirectAllowlistDraft(redirectAllowlistDraftFromSettings(next));
          setNumericDrafts(numericDraftsFromSettings(next));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load MCP settings.");
      });
    return () => { cancelled = true; };
  }, [active, settings]);

  async function save(patch: Partial<AiConnectorPolicySettingsDto> & { mcpOauthTokenSecret?: string | null }) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await postJson<{ freshAuthToken: string }>("/admin/mcp/fresh-auth", {});
      const updated = await patchJson<AiConnectorPolicySettingsDto>(
        "/admin/mcp/settings",
        patch,
        { headers: { "x-vakwen-fresh-auth-at": token.freshAuthToken } },
      );
      setSettings(updated);
      setIssuerDraft(updated.oauthPublicIssuer ?? "");
      setRedirectAllowlistDraft(redirectAllowlistDraftFromSettings(updated));
      setNumericDrafts(numericDraftsFromSettings(updated));
      setSuccess(adminDict.inputs.mcpSettingsSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : adminDict.inputs.mcpSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <Card data-testid="admin-settings-mcp-section">
        <p
          className="text-sm text-slate-600"
          role={error ? "alert" : "status"}
          aria-live="polite"
          aria-busy={error ? undefined : true}
        >
          {error ?? adminDict.inputs.mcpLoading}
        </p>
      </Card>
    );
  }

  const allGroupsDisabled = !settings.groupToggles.read
    && !settings.groupToggles.drafts
    && !settings.groupToggles.write;
  const currentNumericDrafts = numericDrafts ?? numericDraftsFromSettings(settings);
  let numericValidation: string | null = null;
  let numericPatch: Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey> | null = null;
  try {
    numericPatch = parseMcpNumericDrafts(currentNumericDrafts);
  } catch (err) {
    numericValidation = err instanceof Error ? err.message : adminDict.inputs.mcpNumericInvalid;
  }
  const numericDirty = MCP_NUMERIC_FIELDS.some((field) => currentNumericDrafts[field.key] !== String(settings[field.key]));
  const mutationBatchLimitValue = Number(currentNumericDrafts.postedTransactionMutationBatchLimit);
  const showMutationBatchLimitWarning = Number.isInteger(mutationBatchLimitValue) && mutationBatchLimitValue > 200;
  let redirectAllowlistValidation: string | null = null;
  let redirectAllowlistValues: string[] | null = null;
  try {
    redirectAllowlistValues = parseRedirectAllowlistDraft(redirectAllowlistDraft);
  } catch (err) {
    redirectAllowlistValidation = err instanceof Error ? err.message : "Redirect URI allowlist is invalid.";
  }
  const redirectAllowlistSavedDraft = redirectAllowlistDraftFromSettings(settings);
  const redirectAllowlistDraftChanged = redirectAllowlistDraft !== redirectAllowlistSavedDraft;
  const redirectAllowlistDirty = redirectAllowlistValues !== null
    && redirectAllowlistValues.join("\n") !== settings.oauthRedirectUriAllowlist.join("\n");
  const redirectAllowlistDescriptionIds = [
    "admin-settings-mcp-redirect-help",
    "admin-settings-mcp-redirect-examples",
    redirectAllowlistValidation ? "admin-settings-mcp-redirect-error" : null,
  ].filter(Boolean).join(" ");
  const allowedClientKinds = allowedClientKindsRecord(settings);
  const builtInRedirectRows = MCP_BUILT_IN_REDIRECT_ALLOWLIST_EXAMPLES.map((uri) => ({
    uri,
    label: "OpenAI built-in",
  }));
  const customRedirectRows = settings.oauthRedirectUriAllowlist.map((uri) => ({
    uri,
    label: uri.includes("claude.ai") ? "Claude.ai custom" : "Custom callback",
  }));
  const suggestedRedirectRows = [
    { uri: CLAUDE_AI_REDIRECT_URI, label: "Claude.ai quick-add" },
  ].filter((row) => !settings.oauthRedirectUriAllowlist.includes(row.uri));
  const copyRedirectUri = (uri: string) => {
    void navigator.clipboard?.writeText(uri);
  };
  const removeRedirectUri = (uri: string) => {
    setRedirectAllowlistDraft((current) => current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line !== uri)
      .join("\n"));
  };

  return (
    <Card data-testid="admin-settings-mcp-section">
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{isZhTW ? "MCP 設定" : "MCP settings"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {isZhTW ? "全域 AI 連接器政策。儲存前會自動要求重新驗證。" : "Global AI connector policy. Fresh-auth is requested automatically before saving."}
          </p>
        </div>

        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p> : null}
        {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status" aria-live="polite">{success}</p> : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="rounded-xl border border-slate-200 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{isZhTW ? "MCP 就緒狀態" : "MCP readiness"}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {isZhTW
                    ? "使用者 AI 連接器頁會依照這些狀態顯示修復提示。"
                    : "The user AI Connectors page derives repair states from these controls."}
                </p>
              </div>
              <McpStatusChip tone={mcpStatusTone(settings.readiness.status)}>
                {mcpReadinessStatusLabel(settings.readiness.status, isZhTW)}
              </McpStatusChip>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {settings.readiness.checks.map((check) => (
                <McpStatusChip key={check.key} tone={mcpStatusTone(check.status)}>
                  {mcpReadinessCheckLabel(check.key, isZhTW)}
                </McpStatusChip>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 px-4 py-4">
            <h3 className="text-sm font-semibold text-slate-900">{isZhTW ? "稽核影響" : "Audit impact"}</h3>
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p>
                {isZhTW
                  ? "客戶端允許清單與工具群組會立即影響現有連線的有效可用性，並反映到使用者的 Tool Catalog 與 Permissions。"
                  : "Client allowlist and tool-group toggles affect effective availability immediately for existing connectors and show up in the user Tool Catalog and Permissions views."}
              </p>
              <p>
                {isZhTW
                  ? "OAuth 密鑰輪替或清除只會撤銷 OAuth 連接器憑證；Bearer 備援連接器不會被靜默撤銷。"
                  : "Rotating or clearing the OAuth secret revokes OAuth connector credentials only; bearer fallback connectors are not silently revoked."}
              </p>
              <p>
                {isZhTW
                  ? "需要新增 scope 或更換 OAuth 回呼的客戶端，必須重新連線或重新同意。"
                  : "Clients that need broader scopes or a repaired OAuth callback must reconnect and re-consent."}
              </p>
            </div>
          </div>
        </div>

        <div id="client-kind-allowlist" className="scroll-mt-24 rounded-xl border border-slate-200 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{isZhTW ? "客戶端允許清單" : "Client-kind allowlist"}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {isZhTW
                  ? "這是 MCP 連線的第一層客戶端政策；工具群組仍會在下方套用。"
                  : "This is the first client policy layer for MCP connections; tool-group policy still applies below."}
              </p>
            </div>
            <McpStatusChip tone="slate">
              {MCP_CLIENT_ROWS.filter((client) => allowedClientKinds[client.key]).length}/{MCP_CLIENT_ROWS.length}
            </McpStatusChip>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {MCP_CLIENT_ROWS.map((client) => (
              <label key={client.key} className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <AiClientGlyph clientKind={client.key} className="h-9 w-9 rounded-xl" />
                  <span className="min-w-0">
                  <span className="block break-words font-medium text-slate-900">{client.label}</span>
                  <span className="mt-1 block text-xs text-slate-500">{client.vendor} · {client.tier}</span>
                </span>
                </span>
                <Switch
                  checked={allowedClientKinds[client.key] ?? false}
                  disabled={saving}
                  onCheckedChange={(checked) => void save({
                    allowedClientKinds: { ...allowedClientKinds, [client.key]: checked } as AiConnectorPolicySettingsDto["allowedClientKinds"],
                  } as Partial<AiConnectorPolicySettingsDto>)}
                  aria-label={`${client.label} ${isZhTW ? "允許狀態" : "allowlist"}`}
                />
              </label>
            ))}
          </div>
        </div>

        <div id="bearer-fallback-policy" className="scroll-mt-24 rounded-xl border border-slate-200 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{isZhTW ? "Bearer 備援政策" : "Bearer fallback policy"}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {isZhTW
                  ? "Bearer 是開發者 MCP 客戶端的次要路徑。使用者自行建立、只顯示一次、可撤銷且有期限。"
                  : "Bearer is a secondary path for developer MCP clients. Users create their own scoped, one-time-displayed, expiring, revocable connector tokens."}
              </p>
            </div>
            <Switch
              checked={settings.bearerFallback.enabled}
              disabled={saving}
              onCheckedChange={(checked) => void save({
                bearerFallback: { ...settings.bearerFallback, enabled: checked },
              })}
              aria-label={isZhTW ? "啟用 Bearer 備援" : "Enable bearer fallback"}
            />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="grid gap-3 lg:grid-cols-2">
              {MCP_CLIENT_ROWS.filter((client) => client.key !== "chatgpt_app" && client.key !== "claude_ai_connector").map((client) => {
                const checked = settings.bearerFallback.allowedClientKinds.includes(client.key);
                return (
                  <label key={`bearer-${client.key}`} className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-3">
                      <AiClientGlyph clientKind={client.key} className="h-9 w-9 rounded-xl" />
                      <span className="min-w-0">
                      <span className="block break-words font-medium text-slate-900">{client.label}</span>
                      <span className="mt-1 block text-xs text-slate-500">{client.tier}</span>
                    </span>
                    </span>
                    <Switch
                      checked={checked}
                      disabled={saving || !settings.bearerFallback.enabled}
                      onCheckedChange={(nextChecked) => {
                        const nextKinds = nextChecked
                          ? [...new Set([...settings.bearerFallback.allowedClientKinds, client.key])]
                          : settings.bearerFallback.allowedClientKinds.filter((item) => item !== client.key);
                        void save({ bearerFallback: { ...settings.bearerFallback, allowedClientKinds: nextKinds } });
                      }}
                      aria-label={`${client.label} ${isZhTW ? "Bearer 允許狀態" : "bearer allowlist"}`}
                    />
                  </label>
                );
              })}
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                {isZhTW ? "最長有效天數" : "Max lifetime days"}
                <input
                  key={`bearer-lifetime-${settings.bearerFallback.maxLifetimeDays}`}
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={settings.bearerFallback.maxLifetimeDays}
                  disabled={saving || !settings.bearerFallback.enabled}
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isInteger(value) && value >= 1 && value <= 365 && value !== settings.bearerFallback.maxLifetimeDays) {
                      void save({ bearerFallback: { ...settings.bearerFallback, maxLifetimeDays: value } });
                    }
                  }}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {isZhTW ? "每位使用者最大 Bearer 連接器數" : "Max bearer connectors per user"}
                <input
                  key={`bearer-cap-${settings.bearerFallback.maxActiveConnectorsPerUser}`}
                  type="number"
                  min={1}
                  max={25}
                  defaultValue={settings.bearerFallback.maxActiveConnectorsPerUser}
                  disabled={saving || !settings.bearerFallback.enabled}
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isInteger(value) && value >= 1 && value <= 25 && value !== settings.bearerFallback.maxActiveConnectorsPerUser) {
                      void save({ bearerFallback: { ...settings.bearerFallback, maxActiveConnectorsPerUser: value } });
                    }
                  }}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
              <div id="bearer-tool-groups" className="scroll-mt-24 rounded-xl border border-slate-200 px-3 py-3">
                <p className="text-sm font-medium text-slate-700">{isZhTW ? "允許 Bearer 工具群組" : "Allowed bearer tool groups"}</p>
                <div className="mt-2 space-y-2">
                  {(["read", "drafts", "write"] as const).map((group) => {
                    const checked = settings.bearerFallback.allowedToolGroups.includes(group);
                    const label = isZhTW
                      ? group === "read" ? "讀取" : group === "drafts" ? "草稿" : "寫入"
                      : group;
                    return (
                      <label key={`bearer-group-${group}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="capitalize text-slate-700">{label}</span>
                        <Switch
                          checked={checked}
                          disabled={saving || !settings.bearerFallback.enabled}
                          onCheckedChange={(nextChecked) => {
                            const nextGroups = nextChecked
                              ? [...new Set([...settings.bearerFallback.allowedToolGroups, group])]
                              : settings.bearerFallback.allowedToolGroups.filter((item) => item !== group);
                            void save({ bearerFallback: { ...settings.bearerFallback, allowedToolGroups: nextGroups } });
                          }}
                          aria-label={`${label} ${isZhTW ? "Bearer 工具群組" : "bearer tool group"}`}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
            <span className="font-medium text-slate-800">{isZhTW ? "MCP 部署" : "MCP deployment"}</span>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={saving}
              onChange={(event) => void save({ enabled: event.target.checked })}
            />
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{isZhTW ? "工具群組" : "Tool groups"}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {isZhTW
                  ? "比起籠統的高風險提示，這裡直接說明每個群組會打開哪些工具。"
                  : "These toggles name the affected tool groups directly instead of using vague high-risk wording."}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {([
              {
                key: "read" as const,
                title: isZhTW ? "讀取" : "Read",
                count: 28,
                risk: isZhTW ? "低風險，唯讀。" : "Low risk, read-only.",
                examples: "get_portfolio_overview, get_daily_review_report",
              },
              {
                key: "drafts" as const,
                title: isZhTW ? "草稿流程" : "Draft workflow",
                count: 24,
                risk: isZhTW ? "中風險，可建立或修改草稿。" : "Moderate risk, can create or edit draft workflows.",
                examples: "create_transaction_draft_batch, update_transaction_draft_row",
              },
              {
                key: "write" as const,
                title: isZhTW ? "帳戶管理與送出" : "Account management and posting",
                count: 15,
                risk: isZhTW ? "高風險，包含帳戶變更與送出。" : "High risk, includes account changes and posting.",
                examples: "create_account, post_transaction_draft_rows",
              },
            ]).map((group) => (
              <label key={group.key} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{group.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{group.count} tools · {group.risk}</span>
                  <span className="mt-1 block break-all text-xs text-slate-500">{group.examples}</span>
                </span>
                <Switch
                  checked={settings.groupToggles[group.key]}
                  disabled={saving}
                  onCheckedChange={(checked) => void save({ groupToggles: { ...settings.groupToggles, [group.key]: checked } })}
                  aria-label={`${group.title} ${isZhTW ? "工具群組" : "tool group"}`}
                />
              </label>
            ))}
          </div>
        </div>

        {allGroupsDisabled ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
            {isZhTW
              ? "所有 MCP 工具群組都已停用。新的 AI 連接器同意授權會被封鎖，使用者連接器權限控制也會保持停用，直到管理員重新啟用至少一個群組。"
              : "All MCP tool groups are disabled. New AI connector consent approvals are blocked and user connector scope controls stay disabled until an admin re-enables at least one group."}
          </p>
        ) : null}

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-3">
            {MCP_NUMERIC_FIELDS.filter((field) => field.key !== "postedTransactionMutationBatchLimit").map((field) => (
              <label key={field.key} className="text-sm font-medium text-slate-700">
                {isZhTW
                  ? ({
                    maxActiveConnectionsPerUser: "最大啟用連接器數",
                    inactivityExpiryDays: "閒置到期天數",
                    expirationWarningDays: "到期警告天數",
                    maxConnectorLifetimeDays: "連接器最長有效天數",
                    postedTransactionMutationBatchLimit: "每批交易上限",
                  } satisfies Record<McpNumericSettingKey, string>)[field.key]
                  : field.label}
                <input
                  type="number"
                  value={currentNumericDrafts[field.key]}
                  min={field.min}
                  max={field.max}
                  disabled={saving}
                  onChange={(event) => {
                    const { value } = event.target;
                    setNumericDrafts((current) => ({
                      ...(current ?? numericDraftsFromSettings(settings)),
                      [field.key]: value,
                    }));
                  }}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-start gap-2">
              <label
                htmlFor="admin-settings-posted-transaction-mutation-batch-limit"
                className="text-sm font-medium text-slate-700"
              >
                {t("Maximum transactions per batch")}
              </label>
              <TooltipInfo
                label={t("Batch limit guidance")}
                content={t("Values above 200 are still allowed, but can cause large MCP payload or response failures, preview or client timeouts, longer account locks and revision conflicts, rebuild queue backlogs, or a client timeout after the server has already committed.")}
                triggerTestId="admin-settings-posted-transaction-mutation-batch-limit-tooltip-trigger"
                contentTestId="admin-settings-posted-transaction-mutation-batch-limit-tooltip-content"
              />
            </div>
            <input
              id="admin-settings-posted-transaction-mutation-batch-limit"
              type="number"
              value={currentNumericDrafts.postedTransactionMutationBatchLimit}
              min={1}
              inputMode="numeric"
              disabled={saving}
              onChange={(event) => {
                const { value } = event.target;
                setNumericDrafts((current) => ({
                  ...(current ?? numericDraftsFromSettings(settings)),
                  postedTransactionMutationBatchLimit: value,
                }));
              }}
              className="mt-2 block w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2"
              aria-describedby="admin-settings-posted-transaction-mutation-batch-limit-help admin-settings-posted-transaction-mutation-batch-limit-warning"
            />
            <p
              id="admin-settings-posted-transaction-mutation-batch-limit-help"
              className="mt-2 text-sm text-slate-600"
            >
              {t("Default 50 · Effective {value} · No platform hard cap").replace(
                "{value}",
                String(settings.postedTransactionMutationBatchLimit),
              )}
            </p>
            {showMutationBatchLimitWarning ? (
              <p
                id="admin-settings-posted-transaction-mutation-batch-limit-warning"
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
                role="alert"
              >
                {t("Values above 200 are still allowed, but can cause large MCP payload or response failures, preview or client timeouts, longer account locks and revision conflicts, rebuild queue backlogs, or a client timeout after the server has already committed.")}
              </p>
            ) : null}
          </div>
          {numericValidation ? (
            <p className="mt-3 text-sm text-red-700" role="alert">{numericValidation}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || !numericDirty}
              onClick={() => setNumericDrafts(numericDraftsFromSettings(settings))}
            >
              {isZhTW ? "重設限制" : "Reset limits"}
            </Button>
            <Button
              size="sm"
              disabled={saving || !numericDirty || numericValidation !== null || numericPatch === null}
              onClick={() => {
                if (numericPatch) void save(numericPatch);
              }}
            >
              {isZhTW ? "儲存限制" : "Save limits"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "公開 OAuth 發行者" : "Public OAuth issuer"}
            <input
              type="url"
              value={issuerDraft}
              disabled={saving}
              placeholder="https://api.example.com"
              onChange={(event) => setIssuerDraft(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </label>
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setIssuerDraft(settings.oauthPublicIssuer ?? "");
              }}
            >
              {adminDict.common.reset}
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void save({ oauthPublicIssuer: issuerDraft.trim() || null })}
            >
              {isZhTW ? "儲存發行者" : "Save issuer"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900">{isZhTW ? "重新導向回呼" : "Redirect callbacks"}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {isZhTW
                ? "顯示內建、已加入與建議加入的 OAuth 回呼網址。"
                : "Inspect built-in, custom, and suggested OAuth callbacks before editing the freeform allowlist."}
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div data-testid="admin-settings-mcp-built-in-callbacks" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase text-slate-500">{isZhTW ? "內建回呼" : "Built-in callbacks"}</p>
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                {builtInRedirectRows.map((row) => (
                  <div key={`builtin-${row.uri}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="font-medium text-slate-900">{row.label}</p>
                    <p className="mt-1 break-all font-mono">{row.uri}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => copyRedirectUri(row.uri)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      {isZhTW ? "複製回呼" : "Copy callback"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase text-slate-500">{isZhTW ? "自訂允許清單" : "Custom allowlist"}</p>
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                {customRedirectRows.length > 0 ? customRedirectRows.map((row) => (
                  <div key={`custom-${row.uri}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="font-medium text-slate-900">{row.label}</p>
                    <p className="mt-1 break-all font-mono">{row.uri}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => copyRedirectUri(row.uri)}>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        {isZhTW ? "複製回呼" : "Copy callback"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => removeRedirectUri(row.uri)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {isZhTW ? "移除" : "Remove"}
                      </Button>
                    </div>
                  </div>
                )) : (
                  <p>{isZhTW ? "目前沒有自訂回呼。" : "No custom callbacks allowlisted yet."}</p>
                )}
              </div>
            </div>
            <div data-testid="admin-settings-mcp-suggested-callbacks" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase text-slate-500">{isZhTW ? "建議加入" : "Suggested callbacks"}</p>
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                {suggestedRedirectRows.map((row) => (
                  <div key={`suggested-${row.uri}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="font-medium text-slate-900">{row.label}</p>
                    <p className="mt-1 break-all font-mono">{row.uri}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyRedirectUri(row.uri)}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        {isZhTW ? "複製回呼" : "Copy callback"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRedirectAllowlistDraft((current) => {
                          const currentValues = current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
                          return [...new Set([...currentValues, row.uri])].join("\n");
                        })}
                      >
                        {isZhTW ? "快速加入 Claude.ai" : "Quick-add Claude.ai"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "額外重新導向 URI 允許清單" : "Additional redirect URI allowlist"}
            <textarea
              value={redirectAllowlistDraft}
              disabled={saving}
              placeholder="https://chatgpt.com/connector/oauth/abc123"
              onChange={(event) => setRedirectAllowlistDraft(event.target.value)}
              className="mt-1 block min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
              data-testid="admin-settings-mcp-redirect-allowlist"
              aria-describedby={redirectAllowlistDescriptionIds}
              aria-invalid={redirectAllowlistValidation ? true : undefined}
            />
          </label>
          <p id="admin-settings-mcp-redirect-help" className="mt-2 text-xs text-slate-500">
            {isZhTW
              ? "每行一個完整 HTTPS 重新導向 URI。內建 ChatGPT 重新導向模式一律允許。"
              : "One exact HTTPS redirect URI per line. Built-in ChatGPT redirect patterns are always allowed."}
          </p>
          <div id="admin-settings-mcp-redirect-examples" className="mt-3 rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase text-slate-500">{isZhTW ? "範例" : "Examples"}</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {MCP_BUILT_IN_REDIRECT_ALLOWLIST_EXAMPLES.map((example) => (
                <li key={example} className="font-mono">{example}</li>
              ))}
            </ul>
          </div>
          {redirectAllowlistValidation ? (
            <p id="admin-settings-mcp-redirect-error" className="mt-3 text-sm text-red-700" role="alert">{redirectAllowlistValidation}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || !redirectAllowlistDraftChanged}
              onClick={() => setRedirectAllowlistDraft(redirectAllowlistDraftFromSettings(settings))}
            >
              {isZhTW ? "重設允許清單" : "Reset allowlist"}
            </Button>
            <Button
              size="sm"
              disabled={saving || !redirectAllowlistDirty || redirectAllowlistValues === null}
              onClick={() => {
                if (redirectAllowlistValues) void save({ oauthRedirectUriAllowlist: redirectAllowlistValues });
              }}
            >
              {isZhTW ? "儲存允許清單" : "Save allowlist"}
            </Button>
          </div>
        </div>

        <MaskedSecretInput
          fieldKey="mcp-oauth-token-secret"
          label={isZhTW ? "MCP OAuth 權杖密鑰" : "MCP OAuth token secret"}
          description={isZhTW ? "用於簽署 MCP 存取權杖，並雜湊 OAuth code 與 refresh token 的 HMAC 密鑰。" : "HMAC secret used to sign MCP access tokens and hash OAuth codes and refresh tokens."}
          isSet={settings.oauthTokenSecretSet}
          secretLengthBounds={{ min: 32, max: 500 }}
          disabled={saving}
          generateLabel={isZhTW ? "產生 64 位十六進位密鑰" : "Generate 64-hex secret"}
          onGenerateValue={() => generateHexSecret(32)}
          onRotate={(plaintext) => save({ mcpOauthTokenSecret: plaintext })}
          onClear={() => save({ mcpOauthTokenSecret: null })}
        />
      </div>
    </Card>
  );
}

export function AdminSettingsClient({ initial }: AdminSettingsClientProps) {
  const adminDict = useAdminI18n();
  const isZhTW = adminDict.common.justNow === "剛剛";
  const t = (text: string) => translateAdminSettingsCopy(isZhTW, text);
  const [config, setConfig] = useState<AppConfigDto>(initial);

  // ── KZO-199: Tab state synced to ?tab=<slug> URL query ────────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = isValidTabSlug(searchParams?.get("tab") ?? null)
    ? (searchParams!.get("tab") as TabSlug)
    : DEFAULT_TAB;
  const [activeTab, setActiveTab] = useState<TabSlug>(initialTab);

  // Sync local state if the URL changes (e.g. browser back/forward) without
  // a remount.
  useEffect(() => {
    // Sync local `activeTab` from URL on browser back/forward (no remount).
    // `activeTab` is in deps so the effect's stale closure can't overwrite a
    // newer state; the inner `fromUrl !== activeTab` guard breaks any
    // self-feedback (URL update → effect → setActiveTab is a no-op when the
    // URL already matches).
    const fromUrl = searchParams?.get("tab") ?? null;
    if (isValidTabSlug(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl);
    }
  }, [searchParams, activeTab]);

  function handleTabChange(next: string) {
    if (!isValidTabSlug(next)) return;
    setActiveTab(next);
    // Update URL synchronously via the History API so `page.url()` reflects
    // `?tab=<slug>` immediately after the click (E2E spec asserts on it).
    // Next.js's `router.replace` from `next/navigation` is fire-and-forget
    // and briefly lags `page.url()`. Pair with `router.replace` so Next.js's
    // internal router state stays in sync (covers cases where the URL is
    // later read via `useSearchParams`).
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    const url = `/admin/settings?${params.toString()}`;
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", url);
    }
    router.replace(url, { scroll: false });
  }

  // ── Dashboard Timeframe Defaults section state (KZO-159) ───────────────────
  const [pendingRanges, setPendingRanges] = useState<string[]>(
    initial.dashboardPerformanceRanges && initial.dashboardPerformanceRanges.length > 0
      ? [...initial.dashboardPerformanceRanges]
      : [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
  );
  const [customInput, setCustomInput] = useState("");
  const [timeframeSaving, setTimeframeSaving] = useState(false);
  const [timeframeServerError, setTimeframeServerError] = useState<string | null>(null);
  const [timeframeSaveSuccess, setTimeframeSaveSuccess] = useState<string | null>(null);

  // ── Metadata Enrichment Mode section state (KZO-189) ───────────────────────
  // The select value is "" when the admin is using the env default (override
  // cleared); otherwise the explicit override string. PATCH translates "" → null.
  const [metadataEnrichmentMode, setMetadataEnrichmentMode] = useState<string>(
    initial.metadataEnrichmentMode ?? "",
  );
  const [metadataModeSaving, setMetadataModeSaving] = useState(false);
  const [metadataModeError, setMetadataModeError] = useState<string | null>(null);
  const [metadataModeSuccess, setMetadataModeSuccess] = useState<string | null>(null);
  const [routeCachePolicyMode, setRouteCachePolicyMode] = useState<RouteCachePolicyMode | "">(
    initial.routeCachePolicyMode ?? "",
  );
  const [routeCacheModeSaving, setRouteCacheModeSaving] = useState(false);
  const [routeCacheModeError, setRouteCacheModeError] = useState<string | null>(null);
  const [routeCacheModeSuccess, setRouteCacheModeSuccess] = useState<string | null>(null);

  // ── Timeframe section derived state ────────────────────────────────────────
  const trimmedCustomInput = customInput.trim();
  let customInputError: string | null = null;
  if (trimmedCustomInput !== "") {
    if (!isValidPerformanceRange(trimmedCustomInput)) {
      customInputError = TIMEFRAME_INVALID_FORMAT_MSG;
    } else if (pendingRanges.includes(trimmedCustomInput)) {
      customInputError = TIMEFRAME_DUPLICATE_MSG;
    } else if (pendingRanges.length >= 12) {
      customInputError = TIMEFRAME_LIST_TOO_LONG_MSG;
    }
  }

  const listValidation = dashboardPerformanceRangesSchema.safeParse(pendingRanges);
  const listValidationError =
    pendingRanges.length === 0
      ? TIMEFRAME_EMPTY_LIST_MSG
      : listValidation.success
        ? null
        : pendingRanges.length > 12
          ? TIMEFRAME_LIST_TOO_LONG_MSG
          : TIMEFRAME_INVALID_FORMAT_MSG;

  const displayedTimeframeError = customInputError ?? listValidationError ?? timeframeServerError;
  const canAddCustom = !timeframeSaving && trimmedCustomInput !== "" && customInputError === null;
  const canSaveTimeframes =
    !timeframeSaving && pendingRanges.length > 0 && listValidation.success;
  const availablePredefinedChips = PREDEFINED_TIMEFRAME_CHIPS.filter(
    (range) => !pendingRanges.includes(range),
  );

  // ── Timeframe section handlers (KZO-159) ───────────────────────────────────
  function clearTimeframeFeedback() {
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
  }

  function reorderChips(nextOrder: string[]) {
    setPendingRanges(nextOrder);
    clearTimeframeFeedback();
  }

  function toggleChip(range: string) {
    setPendingRanges((prev) =>
      prev.includes(range) ? prev.filter((r) => r !== range) : [...prev, range],
    );
    clearTimeframeFeedback();
  }

  function handleAddCustom() {
    if (!canAddCustom) return;
    setPendingRanges((prev) => [...prev, trimmedCustomInput]);
    setCustomInput("");
    clearTimeframeFeedback();
  }

  async function handleSaveTimeframes() {
    if (!canSaveTimeframes) return;
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
    setTimeframeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        dashboardPerformanceRanges: pendingRanges,
      });
      setConfig(updated);
      setPendingRanges(
        updated.dashboardPerformanceRanges && updated.dashboardPerformanceRanges.length > 0
          ? [...updated.dashboardPerformanceRanges]
          : [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
      );
      setTimeframeSaveSuccess("Timeframes saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setTimeframeServerError(err.message);
      } else if (err instanceof Error) {
        setTimeframeServerError(err.message);
      } else {
        setTimeframeServerError("Failed to save timeframes.");
      }
    } finally {
      setTimeframeSaving(false);
    }
  }

  // ── Metadata Enrichment Mode handlers (KZO-189) ────────────────────────────
  async function handleSaveMetadataMode() {
    setMetadataModeError(null);
    setMetadataModeSuccess(null);
    setMetadataModeSaving(true);
    try {
      const next = metadataEnrichmentMode === "" ? null : metadataEnrichmentMode;
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        metadataEnrichmentMode: next,
      });
      setConfig(updated);
      setMetadataEnrichmentMode(updated.metadataEnrichmentMode ?? "");
      setMetadataModeSuccess("Metadata enrichment mode saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setMetadataModeError(err.message);
      } else if (err instanceof Error) {
        setMetadataModeError(err.message);
      } else {
        setMetadataModeError("Failed to save metadata enrichment mode.");
      }
    } finally {
      setMetadataModeSaving(false);
    }
  }

  // ── KZO-198 Tier 1 numeric override rows + Tier 0 secret rotations ────────
  // A single generic PATCH handler keyed by DTO field name. Each
  // `NumericOverrideRow` and `MaskedSecretInput` calls this with the field
  // name + next value (`null` = reset to env default for Tier 1, or clear
  // for Tier 0). Errors propagate so the row component can render them
  // inline; success refreshes `config` so effective values stay accurate.
  async function patchAppConfigField(field: string, value: number | string | null): Promise<void> {
    const updated = await patchJson<AppConfigDto>("/admin/settings", { [field]: value });
    setConfig(updated);
  }

  const extendedConfig = config as AppConfigDto & Record<string, unknown>;
  const extendedBounds = config.bounds as Record<string, { min: number; max: number } | undefined>;
  const providerPacingRows = [
    {
      field: "finmindProviderMinRequestIntervalMs",
      effectiveField: "effectiveFinmindProviderMinRequestIntervalMs",
      label: "FinMind minimum request interval",
      description: "Configured for TW/US market-data provider pacing. Enforcement is not active in this PR.",
      status: "Configured only",
    },
    {
      field: "twelveDataProviderMinRequestIntervalMs",
      effectiveField: "effectiveTwelveDataProviderMinRequestIntervalMs",
      label: "Twelve Data minimum request interval",
      description: "Configured for AU/KR catalog pacing. Enforcement is not active in this PR.",
      status: "Configured only",
    },
    {
      field: "yahooAuProviderMinRequestIntervalMs",
      effectiveField: "effectiveYahooAuProviderMinRequestIntervalMs",
      label: "Yahoo AU minimum request interval",
      description: "Configured for Yahoo Finance AU pacing. Enforcement is not active in this PR.",
      status: "Configured only",
    },
    {
      field: "yahooKrProviderMinRequestIntervalMs",
      effectiveField: "effectiveYahooKrProviderMinRequestIntervalMs",
      label: "Yahoo KR minimum request interval",
      description: "Configured for Yahoo Finance KR pacing. Enforcement is active in this PR.",
      status: "Enforced now",
    },
    {
      field: "frankfurterProviderMinRequestIntervalMs",
      effectiveField: "effectiveFrankfurterProviderMinRequestIntervalMs",
      label: "Frankfurter minimum request interval",
      description: "Configured for FX refresh pacing. Enforcement is not active in this PR.",
      status: "Configured only",
    },
    {
      field: "asxGicsProviderMinRequestIntervalMs",
      effectiveField: "effectiveAsxGicsProviderMinRequestIntervalMs",
      label: "ASX GICS minimum request interval",
      description: "Configured for ASX GICS refresh pacing. Enforcement is not active in this PR.",
      status: "Configured only",
    },
  ].filter((row) => typeof extendedConfig[row.effectiveField] === "number" && extendedBounds[row.field]);

  async function handleSaveRouteCacheMode() {
    setRouteCacheModeError(null);
    setRouteCacheModeSuccess(null);
    setRouteCacheModeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        routeCachePolicyMode: routeCachePolicyMode === "" ? null : routeCachePolicyMode,
      });
      setConfig(updated);
      setRouteCachePolicyMode(updated.routeCachePolicyMode ?? "");
      setRouteCacheModeSuccess("Route cache policy saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setRouteCacheModeError(err.message);
      } else if (err instanceof Error) {
        setRouteCacheModeError(err.message);
      } else {
        setRouteCacheModeError("Failed to save route cache policy.");
      }
    } finally {
      setRouteCacheModeSaving(false);
    }
  }

  async function handleResetTimeframes() {
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
    setTimeframeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        dashboardPerformanceRanges: null,
      });
      setConfig(updated);
      setPendingRanges([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
      setCustomInput("");
      setTimeframeSaveSuccess("Reset to defaults.");
    } catch (err) {
      if (err instanceof ApiError) {
        setTimeframeServerError(err.message);
      } else if (err instanceof Error) {
        setTimeframeServerError(err.message);
      } else {
        setTimeframeServerError("Failed to reset timeframes.");
      }
    } finally {
      setTimeframeSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="admin-settings-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{t("Settings")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("Runtime configuration. Changes apply immediately and are recorded in the audit log.")}
        </p>
      </div>

      <TabsRoot value={activeTab} onValueChange={handleTabChange}>
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
          <div>
            <aside
              className="hidden rounded-xl border border-border bg-card p-2 shadow-sm md:block"
              aria-label={t("Admin settings sections")}
            >
              <div className="px-2 pb-2 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("Settings")}
                </p>
              </div>
              <TabsList
                data-testid="admin-settings-tabs"
                className="hidden h-auto w-full flex-col items-stretch gap-1 overflow-visible rounded-none border-0 bg-transparent p-0 md:flex"
              >
                {TAB_NAV_ITEMS.map(({ slug, icon: Icon, hint }) => {
                  const isActive = activeTab === slug;
                  return (
                    <TabsTrigger
                      key={slug}
                      value={slug}
                      data-testid={`admin-settings-tab-${slug}`}
                      className={cn(
                        "group h-auto w-full justify-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left",
                        "hover:border-border hover:bg-muted/70 hover:text-foreground",
                        "data-[state=active]:border-border data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none",
                      )}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          isActive ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{t(TAB_LABELS[slug])}</span>
                          {isActive ? (
                            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                              {t("Open")}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                          {t(hint)}
                        </span>
                        <span className="sr-only">{t(TAB_DESCRIPTIONS[slug])}</span>
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </aside>

            <div className="rounded-xl border border-border bg-card p-3 md:hidden">
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="admin-settings-mobile-nav">
                {t("Section")}
              </label>
              <Select value={activeTab} onValueChange={handleTabChange}>
                <SelectTrigger id="admin-settings-mobile-nav" className="w-full" data-testid="admin-settings-mobile-nav">
                  <SelectValue placeholder={t(TAB_LABELS[activeTab])} />
                </SelectTrigger>
                <SelectContent>
                  {TAB_SLUGS.map((slug) => (
                    <SelectItem key={slug} value={slug}>
                      {t(TAB_LABELS[slug])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-sm text-slate-500">{t(TAB_DESCRIPTIONS[activeTab])}</p>
            </div>
          </div>

          <div className="min-w-0">

        {/* ── Rate limits tab ───────────────────────────────────────────── */}
        <TabsContent value="rate-limits" data-testid="admin-settings-panel-rate-limits">
          <Card data-testid="admin-settings-rate-limits-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t("Rate limits")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("Per-IP rate-limiter windows and request budgets. Empty override → fall back to environment value.")}
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="market-data-price-window-ms"
                label={t("Market data price · window")}
                override={config.marketDataPriceWindowMs}
                effective={config.effectiveMarketDataPriceWindowMs}
                bounds={config.bounds.marketDataPriceWindowMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("marketDataPriceWindowMs", v)}
              />
              <NumericOverrideRow
                fieldKey="market-data-price-limit"
                label={t("Market data price · limit")}
                override={config.marketDataPriceLimit}
                effective={config.effectiveMarketDataPriceLimit}
                bounds={config.bounds.marketDataPriceLimit}
                unit="req/window"
                onSave={(v) => patchAppConfigField("marketDataPriceLimit", v)}
              />
              <NumericOverrideRow
                fieldKey="market-data-search-window-ms"
                label={t("Market data search · window")}
                override={config.marketDataSearchWindowMs}
                effective={config.effectiveMarketDataSearchWindowMs}
                bounds={config.bounds.marketDataSearchWindowMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("marketDataSearchWindowMs", v)}
              />
              <NumericOverrideRow
                fieldKey="market-data-search-limit"
                label={t("Market data search · limit")}
                override={config.marketDataSearchLimit}
                effective={config.effectiveMarketDataSearchLimit}
                bounds={config.bounds.marketDataSearchLimit}
                unit="req/window"
                onSave={(v) => patchAppConfigField("marketDataSearchLimit", v)}
              />
              <NumericOverrideRow
                fieldKey="invite-status-window-ms"
                label={t("Invite status · window")}
                override={config.inviteStatusWindowMs}
                effective={config.effectiveInviteStatusWindowMs}
                bounds={config.bounds.inviteStatusWindowMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("inviteStatusWindowMs", v)}
              />
              <NumericOverrideRow
                fieldKey="invite-status-limit"
                label={t("Invite status · limit")}
                override={config.inviteStatusLimit}
                effective={config.effectiveInviteStatusLimit}
                bounds={config.bounds.inviteStatusLimit}
                unit="req/window"
                onSave={(v) => patchAppConfigField("inviteStatusLimit", v)}
              />
            </div>
          </Card>
        </TabsContent>

        {/* ── Sharing tab (KZO-199 NEW) ─────────────────────────────────── */}
        <TabsContent value="sharing" data-testid="admin-settings-panel-sharing">
          <Card data-testid="admin-settings-sharing-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t("Sharing")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("Anonymous-share-token cap and per-IP rate limits. Off = use the environment default.")}
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="anonymousShareTokenCap"
                label={t("Anonymous share token cap")}
                description={t("Maximum active anonymous share tokens per owner. New token requests above this fail with cap-exceeded.")}
                override={config.anonymousShareTokenCap}
                effective={config.effectiveAnonymousShareTokenCap}
                bounds={config.bounds.anonymousShareTokenCap}
                unit="tokens"
                inputTestId="admin-settings-input-anonymousShareTokenCap"
                onSave={(v) => patchAppConfigField("anonymousShareTokenCap", v)}
              />
              <NumericOverrideRow
                fieldKey="anonymousShareRateLimitMax"
                label={t("Anonymous share rate limit · max")}
                description={t("Maximum requests per window for anonymous-share endpoints (per IP).")}
                override={config.anonymousShareRateLimitMax}
                effective={config.effectiveAnonymousShareRateLimitMax}
                bounds={config.bounds.anonymousShareRateLimitMax}
                unit="req/window"
                inputTestId="admin-settings-input-anonymousShareRateLimitMax"
                onSave={(v) => patchAppConfigField("anonymousShareRateLimitMax", v)}
              />
              <NumericOverrideRow
                fieldKey="anonymousShareRateLimitWindowMs"
                label={t("Anonymous share rate limit · window")}
                description={t("Sliding-window length for the anonymous-share rate limiter.")}
                override={config.anonymousShareRateLimitWindowMs}
                effective={config.effectiveAnonymousShareRateLimitWindowMs}
                bounds={config.bounds.anonymousShareRateLimitWindowMs}
                unit="ms"
                inputTestId="admin-settings-input-anonymousShareRateLimitWindowMs"
                onSave={(v) => patchAppConfigField("anonymousShareRateLimitWindowMs", v)}
              />
            </div>
          </Card>
        </TabsContent>

        {/* ── Provider health tab ───────────────────────────────────────── */}
        <TabsContent value="provider-health" data-testid="admin-settings-panel-provider-health">
          <Card data-testid="admin-settings-provider-health-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t("Provider health")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("Notification suppression, error-trail retention, and re-run cooldown for the provider health surface.")}
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="provider-down-suppression-ms"
                label={t("Down notification suppression")}
                description={t("Cooldown between repeat 'provider down' notifications for the same provider+market.")}
                override={config.providerDownNotificationSuppressionMs}
                effective={config.effectiveProviderDownNotificationSuppressionMs}
                bounds={config.bounds.providerDownNotificationSuppressionMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("providerDownNotificationSuppressionMs", v)}
              />
              <NumericOverrideRow
                fieldKey="provider-error-trail-retention-days"
                label={t("Error trail retention")}
                description={t("Days of historical provider errors to keep before the purge cron evicts them.")}
                override={config.providerErrorTrailRetentionDays}
                effective={config.effectiveProviderErrorTrailRetentionDays}
                bounds={config.bounds.providerErrorTrailRetentionDays}
                unit="days"
                onSave={(v) => patchAppConfigField("providerErrorTrailRetentionDays", v)}
              />
              <NumericOverrideRow
                fieldKey="provider-rerun-cooldown-ms"
                label={t("Re-run cooldown")}
                description={t("Minimum interval between admin-triggered re-runs for the same provider+market.")}
                override={config.providerRerunCooldownMs}
                effective={config.effectiveProviderRerunCooldownMs}
                bounds={config.bounds.providerRerunCooldownMs}
                unit="ms"
                onSave={(v) => patchAppConfigField("providerRerunCooldownMs", v)}
              />
              {/* KZO-197 (surfaced in KZO-199 Phase 4) — yahoo-finance-au override. */}
              <NumericOverrideRow
                fieldKey="yahooAuRerunCooldownMs"
                label={t("Yahoo Finance AU re-run cooldown")}
                description={t("Yahoo-AU-specific override for the re-run cooldown. Falls back to the generic re-run cooldown when off.")}
                override={config.yahooAuRerunCooldownMs}
                effective={config.effectiveYahooAuRerunCooldownMs}
                bounds={config.bounds.yahooAuRerunCooldownMs}
                unit="ms"
                inputTestId="admin-settings-input-yahooAuRerunCooldownMs"
                onSave={(v) => patchAppConfigField("yahooAuRerunCooldownMs", v)}
              />
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">{t("Provider operations guardrails")}</h3>
              </div>
              <NumericOverrideRow
                fieldKey="providerFixerDangerousMatchThreshold"
                label={t("Dangerous match threshold")}
                description={t("Operations at or above this match count require typed confirmation before execution.")}
                override={config.providerFixerDangerousMatchThreshold}
                effective={config.effectiveProviderFixerDangerousMatchThreshold}
                bounds={config.bounds.providerFixerDangerousMatchThreshold}
                unit="rows"
                inputTestId="admin-settings-input-providerFixerDangerousMatchThreshold"
                onSave={(v) => patchAppConfigField("providerFixerDangerousMatchThreshold", v)}
              />
              <NumericOverrideRow
                fieldKey="providerFixerPreviewSampleLimit"
                label={t("Preview sample limit")}
                description={t("Maximum evidence rows captured in a provider operation preview.")}
                override={config.providerFixerPreviewSampleLimit}
                effective={config.effectiveProviderFixerPreviewSampleLimit}
                bounds={config.bounds.providerFixerPreviewSampleLimit}
                unit="rows"
                inputTestId="admin-settings-input-providerFixerPreviewSampleLimit"
                onSave={(v) => patchAppConfigField("providerFixerPreviewSampleLimit", v)}
              />
              <NumericOverrideRow
                fieldKey="providerFixerUiPageSize"
                label={t("Provider operations page size")}
                description={t("Default page size for provider operation, log, and evidence tables.")}
                override={config.providerFixerUiPageSize}
                effective={config.effectiveProviderFixerUiPageSize}
                bounds={config.bounds.providerFixerUiPageSize}
                unit="rows"
                inputTestId="admin-settings-input-providerFixerUiPageSize"
                onSave={(v) => patchAppConfigField("providerFixerUiPageSize", v)}
              />
              <NumericOverrideRow
                fieldKey="providerFixerAutoPauseFailuresPerMinute"
                label={t("Auto-pause failures per minute")}
                description={t("Failure rate that auto-pauses a running provider operation.")}
                override={config.providerFixerAutoPauseFailuresPerMinute}
                effective={config.effectiveProviderFixerAutoPauseFailuresPerMinute}
                bounds={config.bounds.providerFixerAutoPauseFailuresPerMinute}
                unit="/min"
                inputTestId="admin-settings-input-providerFixerAutoPauseFailuresPerMinute"
                onSave={(v) => patchAppConfigField("providerFixerAutoPauseFailuresPerMinute", v)}
              />
              <NumericOverrideRow
                fieldKey="providerFixerPreviewTokenTtlMinutes"
                label={t("Preview token TTL")}
                description={t("Minutes before a provider operation preview token expires.")}
                override={config.providerFixerPreviewTokenTtlMinutes}
                effective={config.effectiveProviderFixerPreviewTokenTtlMinutes}
                bounds={config.bounds.providerFixerPreviewTokenTtlMinutes}
                unit="min"
                inputTestId="admin-settings-input-providerFixerPreviewTokenTtlMinutes"
                onSave={(v) => patchAppConfigField("providerFixerPreviewTokenTtlMinutes", v)}
              />
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">{t("Provider operation automation")}</h3>
              </div>
              <NumericOverrideRow
                fieldKey="providerOperationAutoRenewIntervalMinutes"
                label={t("Auto-renew interval")}
                description={t("Cadence for refreshing unresolved evidence without writing mappings or bars.")}
                override={config.providerOperationAutoRenewIntervalMinutes}
                effective={config.effectiveProviderOperationAutoRenewIntervalMinutes}
                bounds={config.bounds.providerOperationAutoRenewIntervalMinutes}
                unit="min"
                inputTestId="admin-settings-input-providerOperationAutoRenewIntervalMinutes"
                onSave={(v) => patchAppConfigField("providerOperationAutoRenewIntervalMinutes", v)}
              />
              <NumericOverrideRow
                fieldKey="providerIncidentRecurrenceWindowMinutes"
                label={t("Incident recurrence window")}
                description={t("Repeated provider errors inside this window update the existing incident instead of creating a new one.")}
                override={config.providerIncidentRecurrenceWindowMinutes}
                effective={config.effectiveProviderIncidentRecurrenceWindowMinutes}
                bounds={config.bounds.providerIncidentRecurrenceWindowMinutes}
                unit="min"
                inputTestId="admin-settings-input-providerIncidentRecurrenceWindowMinutes"
                onSave={(v) => patchAppConfigField("providerIncidentRecurrenceWindowMinutes", v)}
              />
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">{t("Provider health thresholds")}</h3>
              </div>
              <NumericOverrideRow
                fieldKey="providerHealthWarningUnresolvedThreshold"
                label={t("Warning unresolved threshold")}
                description={t("Active unresolved item count that moves provider health to warning.")}
                override={config.providerHealthWarningUnresolvedThreshold}
                effective={config.effectiveProviderHealthWarningUnresolvedThreshold}
                bounds={config.bounds.providerHealthWarningUnresolvedThreshold}
                unit="items"
                inputTestId="admin-settings-input-providerHealthWarningUnresolvedThreshold"
                onSave={(v) => patchAppConfigField("providerHealthWarningUnresolvedThreshold", v)}
              />
              <NumericOverrideRow
                fieldKey="providerHealthCriticalUnresolvedThreshold"
                label={t("Critical unresolved threshold")}
                description={t("Active unresolved item count that moves provider health to critical. Must stay above the warning threshold.")}
                override={config.providerHealthCriticalUnresolvedThreshold}
                effective={config.effectiveProviderHealthCriticalUnresolvedThreshold}
                bounds={config.bounds.providerHealthCriticalUnresolvedThreshold}
                unit="items"
                inputTestId="admin-settings-input-providerHealthCriticalUnresolvedThreshold"
                onSave={(v) => patchAppConfigField("providerHealthCriticalUnresolvedThreshold", v)}
              />
              <NumericOverrideRow
                fieldKey="providerOperationStaleHeartbeatMinutes"
                label={t("Stale operation heartbeat")}
                description={t("Running operation age without progress before it is treated as stale in the admin console.")}
                override={config.providerOperationStaleHeartbeatMinutes}
                effective={config.effectiveProviderOperationStaleHeartbeatMinutes}
                bounds={config.bounds.providerOperationStaleHeartbeatMinutes}
                unit="min"
                inputTestId="admin-settings-input-providerOperationStaleHeartbeatMinutes"
                onSave={(v) => patchAppConfigField("providerOperationStaleHeartbeatMinutes", v)}
              />
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">{t("Provider retention")}</h3>
              </div>
              <NumericOverrideRow
                fieldKey="providerOperationSummaryRetentionDays"
                label={t("Operation summary retention")}
                description={t("Days to keep completed provider operation summaries before retention cleanup.")}
                override={config.providerOperationSummaryRetentionDays}
                effective={config.effectiveProviderOperationSummaryRetentionDays}
                bounds={config.bounds.providerOperationSummaryRetentionDays}
                unit="days"
                inputTestId="admin-settings-input-providerOperationSummaryRetentionDays"
                onSave={(v) => patchAppConfigField("providerOperationSummaryRetentionDays", v)}
              />
              <NumericOverrideRow
                fieldKey="providerOperationLogRetentionDays"
                label={t("Operation log retention")}
                description={t("Days to keep provider operation logs before retention cleanup or guarded purge.")}
                override={config.providerOperationLogRetentionDays}
                effective={config.effectiveProviderOperationLogRetentionDays}
                bounds={config.bounds.providerOperationLogRetentionDays}
                unit="days"
                inputTestId="admin-settings-input-providerOperationLogRetentionDays"
                onSave={(v) => patchAppConfigField("providerOperationLogRetentionDays", v)}
              />
              <NumericOverrideRow
                fieldKey="providerIncidentRetentionDays"
                label={t("Incident retention")}
                description={t("Days to keep resolved or ignored provider incidents.")}
                override={config.providerIncidentRetentionDays}
                effective={config.effectiveProviderIncidentRetentionDays}
                bounds={config.bounds.providerIncidentRetentionDays}
                unit="days"
                inputTestId="admin-settings-input-providerIncidentRetentionDays"
                onSave={(v) => patchAppConfigField("providerIncidentRetentionDays", v)}
              />
              <NumericOverrideRow
                fieldKey="providerResolvedItemRetentionDays"
                label={t("Resolved item retention")}
                description={t("Days to keep resolved unresolved-item records for audit and recently resolved views.")}
                override={config.providerResolvedItemRetentionDays}
                effective={config.effectiveProviderResolvedItemRetentionDays}
                bounds={config.bounds.providerResolvedItemRetentionDays}
                unit="days"
                inputTestId="admin-settings-input-providerResolvedItemRetentionDays"
                onSave={(v) => patchAppConfigField("providerResolvedItemRetentionDays", v)}
              />
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">{t("Provider operation budgets")}</h3>
              </div>
              <NumericOverrideRow
                fieldKey="finmindProviderRateLimitPerHour"
                label={t("FinMind shared hourly cap")}
                description={t("Shared TW/US provider budget. Must stay below the configured upstream FinMind budget.")}
                override={config.finmindProviderRateLimitPerHour}
                effective={config.effectiveFinmindProviderRateLimitPerHour}
                bounds={config.bounds.finmindProviderRateLimitPerHour}
                unit="/hr"
                inputTestId="admin-settings-input-finmindProviderRateLimitPerHour"
                onSave={(v) => patchAppConfigField("finmindProviderRateLimitPerHour", v)}
              />
              <NumericOverrideRow
                fieldKey="twelveDataProviderRateLimitPerMinute"
                label={t("Twelve Data shared per-minute cap")}
                description={t("Shared AU/KR catalog budget. Must stay below the configured upstream Twelve Data budget.")}
                override={config.twelveDataProviderRateLimitPerMinute}
                effective={config.effectiveTwelveDataProviderRateLimitPerMinute}
                bounds={config.bounds.twelveDataProviderRateLimitPerMinute}
                unit="/min"
                inputTestId="admin-settings-input-twelveDataProviderRateLimitPerMinute"
                onSave={(v) => patchAppConfigField("twelveDataProviderRateLimitPerMinute", v)}
              />
              <NumericOverrideRow
                fieldKey="yahooAuProviderRateLimitPerMinute"
                label={t("Yahoo AU per-minute cap")}
                description={t("Yahoo Finance AU operation budget. Must stay below the configured upstream budget.")}
                override={config.yahooAuProviderRateLimitPerMinute}
                effective={config.effectiveYahooAuProviderRateLimitPerMinute}
                bounds={config.bounds.yahooAuProviderRateLimitPerMinute}
                unit="/min"
                inputTestId="admin-settings-input-yahooAuProviderRateLimitPerMinute"
                onSave={(v) => patchAppConfigField("yahooAuProviderRateLimitPerMinute", v)}
              />
              <NumericOverrideRow
                fieldKey="yahooKrProviderRateLimitPerMinute"
                label={t("Yahoo KR per-minute cap")}
                description={t("Yahoo Finance KR operation budget. Must stay below the configured upstream budget.")}
                override={config.yahooKrProviderRateLimitPerMinute}
                effective={config.effectiveYahooKrProviderRateLimitPerMinute}
                bounds={config.bounds.yahooKrProviderRateLimitPerMinute}
                unit="/min"
                inputTestId="admin-settings-input-yahooKrProviderRateLimitPerMinute"
                onSave={(v) => patchAppConfigField("yahooKrProviderRateLimitPerMinute", v)}
              />
              <NumericOverrideRow
                fieldKey="frankfurterProviderRateLimitPerMinute"
                label={t("Frankfurter per-minute cap")}
                description={t("Frankfurter FX refresh operation budget. Must stay below the configured provider ceiling.")}
                override={config.frankfurterProviderRateLimitPerMinute}
                effective={config.effectiveFrankfurterProviderRateLimitPerMinute}
                bounds={config.bounds.frankfurterProviderRateLimitPerMinute}
                unit="/min"
                inputTestId="admin-settings-input-frankfurterProviderRateLimitPerMinute"
                onSave={(v) => patchAppConfigField("frankfurterProviderRateLimitPerMinute", v)}
              />
              <NumericOverrideRow
                fieldKey="asxGicsProviderRateLimitPerHour"
                label={t("ASX GICS hourly cap")}
                description={t("ASX GICS CSV refresh pacing. Must stay below the configured provider ceiling.")}
                override={config.asxGicsProviderRateLimitPerHour}
                effective={config.effectiveAsxGicsProviderRateLimitPerHour}
                bounds={config.bounds.asxGicsProviderRateLimitPerHour}
                unit="/hr"
                inputTestId="admin-settings-input-asxGicsProviderRateLimitPerHour"
                onSave={(v) => patchAppConfigField("asxGicsProviderRateLimitPerHour", v)}
              />
              {providerPacingRows.length > 0 ? (
                <>
                  <div className="border-t border-slate-200 pt-5">
                    <h3 className="text-sm font-semibold text-slate-900">{t("Provider pacing")}</h3>
                    <p className="mt-2 text-sm text-slate-600">{t("Minimum spacing between provider requests. Null uses the default; 0 disables spacing.")}</p>
                  </div>
                  {providerPacingRows.map((row) => (
                    <div key={row.field}>
                      <NumericOverrideRow
                        fieldKey={row.field}
                        label={t(row.label)}
                        description={`${t(row.description)} ${t("Status")}: ${t(row.status)}.`}
                        override={(extendedConfig[row.field] as number | null | undefined) ?? null}
                        effective={extendedConfig[row.effectiveField] as number}
                        bounds={extendedBounds[row.field]!}
                        unit="ms"
                        inputTestId={`admin-settings-input-${row.field}`}
                        onSave={(v) => patchAppConfigField(row.field, v)}
                      />
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </Card>
          <div className="mt-6">
            <TickerPriceFreshnessSettingsCard
              config={config}
              isZhTW={isZhTW}
              onUpdated={setConfig}
            />
          </div>
        </TabsContent>

        {/* ── Backfill & repair tab (Repair cooldown + Backfill knobs) ─── */}
        <TabsContent value="backfill-repair" data-testid="admin-settings-panel-backfill-repair">
          <div className="space-y-6">
            <Card data-testid="admin-settings-repair-cooldown-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{t("Repair cooldown")}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("Minimum wait time (in minutes) between repair runs for the same symbol. Off = use the environment default.")}
                  </p>
                </div>
                <NumericOverrideRow
                  fieldKey="repair-cooldown-minutes"
                  label={t("Cooldown")}
                  override={config.repairCooldownMinutes}
                  effective={config.effectiveRepairCooldownMinutes}
                  bounds={config.bounds.repairCooldownMinutes}
                  unit="min"
                  onSave={(v) => patchAppConfigField("repairCooldownMinutes", v)}
                />
              </div>
            </Card>
            <Card data-testid="admin-settings-backfill-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{t("Backfill")}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("Retry budget and rate-limit backoff for the FinMind/Yahoo backfill worker.")}
                  </p>
                </div>
                <NumericOverrideRow
                  fieldKey="backfill-retry-limit"
                  label={t("Retry limit")}
                  description={t("Maximum pg-boss retry attempts per backfill job before it is marked failed.")}
                  override={config.backfillRetryLimit}
                  effective={config.effectiveBackfillRetryLimit}
                  bounds={config.bounds.backfillRetryLimit}
                  unit="attempts"
                  onSave={(v) => patchAppConfigField("backfillRetryLimit", v)}
                />
                <NumericOverrideRow
                  fieldKey="backfill-retry-delay-seconds"
                  label={t("Retry delay")}
                  description={t("Base backoff between failed retries. The reschedule path additionally honours provider Retry-After.")}
                  override={config.backfillRetryDelaySeconds}
                  effective={config.effectiveBackfillRetryDelaySeconds}
                  bounds={config.bounds.backfillRetryDelaySeconds}
                  unit="s"
                  onSave={(v) => patchAppConfigField("backfillRetryDelaySeconds", v)}
                />
                <NumericOverrideRow
                  fieldKey="backfill-finmind-402-retry-ms"
                  label={t("FinMind 402 retry")}
                  description={t("Pause window after FinMind returns HTTP 402 (quota exceeded) before resuming the queue.")}
                  override={config.backfillFinmind402RetryMs}
                  effective={config.effectiveBackfillFinmind402RetryMs}
                  bounds={config.bounds.backfillFinmind402RetryMs}
                  unit="ms"
                  onSave={(v) => patchAppConfigField("backfillFinmind402RetryMs", v)}
                />
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ── Catalog & metadata tab (Metadata enrichment mode) ─────────── */}
        <TabsContent value="catalog-metadata" data-testid="admin-settings-panel-catalog-metadata">
          <div className="space-y-6">
            {/* KZO-195 Tier-2 absence-based delisting detection (surfaced in
                KZO-199 Phase 4 — DTO + PATCH already in place since KZO-195;
                this surfaces them as admin-tunable rows). */}
            <Card data-testid="admin-settings-catalog-absence-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{t("Absence-based delisting detection")}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("Thresholds that govern when a catalog instrument is auto-flagged as delisted. Off = use the environment defaults.")}
                  </p>
                </div>
                <NumericOverrideRow
                  fieldKey="catalogAbsenceThreshold"
                  label={t("Absence threshold")}
                  description={t("Number of consecutive catalog-sync runs an instrument must be absent before being flagged delisted.")}
                  override={config.catalogAbsenceThreshold}
                  effective={config.effectiveCatalogAbsenceThreshold}
                  bounds={config.bounds.catalogAbsenceThreshold}
                  unit="runs"
                  inputTestId="admin-settings-input-catalogAbsenceThreshold"
                  onSave={(v) => patchAppConfigField("catalogAbsenceThreshold", v)}
                />
                <NumericOverrideRow
                  fieldKey="catalogAbsenceGuardPercent"
                  label={t("Absence guard · percent")}
                  description={t("Reject a catalog-sync diff that would mark more than this percent of the universe absent in a single run.")}
                  override={config.catalogAbsenceGuardPercent}
                  effective={config.effectiveCatalogAbsenceGuardPercent}
                  bounds={config.bounds.catalogAbsenceGuardPercent}
                  unit="%"
                  inputTestId="admin-settings-input-catalogAbsenceGuardPercent"
                  onSave={(v) => patchAppConfigField("catalogAbsenceGuardPercent", v)}
                />
                <NumericOverrideRow
                  fieldKey="catalogAbsenceGuardFloor"
                  label={t("Absence guard · floor")}
                  description={t("Minimum absent-row count below which the percent guard does not engage (small universes are forgiving).")}
                  override={config.catalogAbsenceGuardFloor}
                  effective={config.effectiveCatalogAbsenceGuardFloor}
                  bounds={config.bounds.catalogAbsenceGuardFloor}
                  unit="rows"
                  inputTestId="admin-settings-input-catalogAbsenceGuardFloor"
                  onSave={(v) => patchAppConfigField("catalogAbsenceGuardFloor", v)}
                />
              </div>
            </Card>

            <Card data-testid="admin-settings-metadata-enrichment-mode-section">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{t("Metadata enrichment mode")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {isZhTW
                    ? "控制澳洲標的中繼資料（名稱、類型）是在每次回補時補全，或只在使用者觸發時補全。使用「每日更新時略過」可在每日更新排程掃描所有監控代號時節省 Yahoo 配額。"
                    : <>Controls whether AU instrument metadata (name, type) is enriched on every backfill or
                      only on user-driven triggers. Use {`"Skip on daily refresh"`} to conserve the Yahoo
                      budget when the daily-refresh cron sweeps every monitored ticker.</>}
                </p>
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-slate-700"
                  htmlFor="admin-settings-metadata-enrichment-mode-select"
                >
                  {t("Mode")}
                </label>
                <select
                  id="admin-settings-metadata-enrichment-mode-select"
                  value={metadataEnrichmentMode}
                  onChange={(e) => {
                    setMetadataEnrichmentMode(e.target.value);
                    setMetadataModeError(null);
                    setMetadataModeSuccess(null);
                  }}
                  disabled={metadataModeSaving}
                  className="mt-1 w-72 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  data-testid="admin-settings-metadata-enrichment-mode-select"
                >
                  <option value="">
                    {t("Use environment default")} ({config.effectiveMetadataEnrichmentMode})
                  </option>
                  <option value="unconditional">{t("Always enrich (unconditional)")}</option>
                  <option value="conditional">{t("Skip on daily refresh (conditional)")}</option>
                </select>
                <p
                  className="mt-2 text-xs text-slate-500"
                  data-testid="admin-settings-metadata-enrichment-mode-effective"
                >
                  {t("Effective:")} {config.effectiveMetadataEnrichmentMode}
                  {config.metadataEnrichmentMode === null ? ` ${t("(env default)")}` : ` ${t("(admin override)")}`}
                </p>
              </div>

              {metadataModeError && (
                <p
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                  data-testid="admin-settings-metadata-enrichment-mode-error"
                >
                  {metadataModeError}
                </p>
              )}

              {metadataModeSuccess && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                  role="status"
                  data-testid="admin-settings-metadata-enrichment-mode-success"
                >
                  {metadataModeSuccess}
                </p>
              )}

                <div className="flex items-center justify-end">
                  <Button
                    onClick={() => void handleSaveMetadataMode()}
                    disabled={metadataModeSaving}
                    data-testid="admin-settings-metadata-enrichment-mode-save"
                  >
                    {metadataModeSaving ? adminDict.common.saving : adminDict.common.save}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ── Display defaults tab (Dashboard Timeframe Defaults) ────────── */}
        <TabsContent value="display-defaults" data-testid="admin-settings-panel-display-defaults">
          {/* ── KZO-159: Dashboard Timeframe Defaults section ─────────────── */}
          <Card data-testid="timeframe-defaults-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t("Dashboard Timeframe Defaults")}</h2>
                <p className="mt-1 text-sm text-slate-600">{t(TIMEFRAME_HELPER_TEXT)}</p>
              </div>
    
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("Active timeframes")}
                </p>
                {pendingRanges.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("No active timeframes — add at least one.")}</p>
                ) : (
                  // KZO-161 (158C) F4a: dnd-kit retrofit. Drop-in replacement for
                  // the ↑/↓ arrow buttons — `timeframe-chip-{range}` testid is
                  // preserved (referenced by `[timeframe-A..J]`); `-up/-down` are
                  // intentionally dropped (no dnd-kit boundary-disabled concept).
                  // Remove-from-active happens via a click on the chip itself
                  // (SortableRangeList renders the chip as a button when
                  // `onToggleVisibility` is provided). `toggleTestId` is
                  // intentionally omitted — admin has one toggle affordance, the
                  // chip; the popover variant adds a second dedicated button.
                  <SortableRangeList
                    rows={pendingRanges.map<SortableRangeRow>((range) => ({
                      range,
                      active: true,
                      disabled: timeframeSaving,
                    }))}
                    onReorder={reorderChips}
                    onToggleVisibility={(range) => toggleChip(range)}
                    dragHandleTestId={(r) => `timeframe-drag-handle-${r}`}
                    chipTestId={(r) => `timeframe-chip-${r}`}
                    toggleLabel={(r) => isZhTW ? `從啟用時間範圍移除 ${r}` : `Remove ${r} from active timeframes`}
                  />
                )}
              </div>
    
              {availablePredefinedChips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("Available")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availablePredefinedChips.map((range) => (
                      <button
                        key={range}
                        type="button"
                        aria-label={isZhTW ? `新增 ${range} 到啟用時間範圍` : `Add ${range} to active timeframes`}
                        onClick={() => toggleChip(range)}
                        disabled={timeframeSaving}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid={`timeframe-chip-${range}`}
                        data-active="false"
                      >
                        + {range}
                      </button>
                    ))}
                  </div>
                </div>
              )}
    
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="timeframe-add-input">
                  {t("Add custom range")}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="timeframe-add-input"
                    type="text"
                    value={customInput}
                    onChange={(e) => {
                      setCustomInput(e.target.value);
                      clearTimeframeFeedback();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canAddCustom) {
                        e.preventDefault();
                        handleAddCustom();
                      }
                    }}
                    disabled={timeframeSaving}
                    placeholder={isZhTW ? "例如 5Y、18M、ALL" : "e.g. 5Y, 18M, ALL"}
                    className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    data-testid="timeframe-add-input"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAddCustom}
                    disabled={!canAddCustom}
                    data-testid="timeframe-add-button"
                  >
                    {t("Add")}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  {t("Format:")} {`{n}M`}, {`{n}Y`}, YTD, {isZhTW ? "或" : "or"} ALL. {isZhTW ? "月數 ≤ 240，年數 ≤ 50。" : "Months ≤ 240, years ≤ 50."}
                </p>
              </div>
    
              {displayedTimeframeError && (
                <p
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                  data-testid="timeframe-validation-error"
                >
                  {displayedTimeframeError}
                </p>
              )}
    
              {timeframeSaveSuccess && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                  role="status"
                  data-testid="timeframe-save-success"
                >
                  {timeframeSaveSuccess}
                </p>
              )}
    
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleResetTimeframes()}
                  disabled={timeframeSaving}
                  data-testid="timeframe-reset-button"
                >
                  {t("Reset to defaults")}
                </Button>
                <Button
                  onClick={() => void handleSaveTimeframes()}
                  disabled={!canSaveTimeframes}
                  data-testid="timeframe-save-button"
                >
                  {timeframeSaving ? adminDict.common.saving : adminDict.common.save}
                </Button>
              </div>
            </div>
          </Card>

          <Card data-testid="valuation-health-thresholds-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Valuation health thresholds</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Controls when Dashboard and Reports treat the current-vs-snapshot valuation gap as material.
                </p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <NumericOverrideRow
                  fieldKey="valuationHealthRelativeBps"
                  label="Relative threshold"
                  description="Material gap threshold in basis points."
                  override={config.valuationHealthRelativeBps}
                  effective={config.effectiveValuationHealthRelativeBps}
                  bounds={config.bounds.valuationHealthRelativeBps}
                  unit="bps"
                  inputTestId="admin-settings-input-valuationHealthRelativeBps"
                  onSave={(v) => patchAppConfigField("valuationHealthRelativeBps", v)}
                />
                <NumericOverrideRow
                  fieldKey="valuationHealthAbsoluteAud"
                  label="Absolute AUD threshold"
                  description="Absolute materiality threshold when reporting currency resolves to AUD."
                  override={config.valuationHealthAbsoluteAud}
                  effective={config.effectiveValuationHealthAbsoluteAud}
                  bounds={config.bounds.valuationHealthAbsoluteAud}
                  step="any"
                  unit="AUD"
                  inputTestId="admin-settings-input-valuationHealthAbsoluteAud"
                  onSave={(v) => patchAppConfigField("valuationHealthAbsoluteAud", v)}
                />
                <NumericOverrideRow
                  fieldKey="valuationHealthAbsoluteUsd"
                  label="Absolute USD threshold"
                  description="Absolute materiality threshold when reporting currency resolves to USD."
                  override={config.valuationHealthAbsoluteUsd}
                  effective={config.effectiveValuationHealthAbsoluteUsd}
                  bounds={config.bounds.valuationHealthAbsoluteUsd}
                  step="any"
                  unit="USD"
                  inputTestId="admin-settings-input-valuationHealthAbsoluteUsd"
                  onSave={(v) => patchAppConfigField("valuationHealthAbsoluteUsd", v)}
                />
                <NumericOverrideRow
                  fieldKey="valuationHealthAbsoluteTwd"
                  label="Absolute TWD threshold"
                  description="Absolute materiality threshold when reporting currency resolves to TWD."
                  override={config.valuationHealthAbsoluteTwd}
                  effective={config.effectiveValuationHealthAbsoluteTwd}
                  bounds={config.bounds.valuationHealthAbsoluteTwd}
                  step="any"
                  unit="TWD"
                  inputTestId="admin-settings-input-valuationHealthAbsoluteTwd"
                  onSave={(v) => patchAppConfigField("valuationHealthAbsoluteTwd", v)}
                />
                <NumericOverrideRow
                  fieldKey="valuationHealthAbsoluteKrw"
                  label="Absolute KRW threshold"
                  description="Absolute materiality threshold when reporting currency resolves to KRW."
                  override={config.valuationHealthAbsoluteKrw}
                  effective={config.effectiveValuationHealthAbsoluteKrw}
                  bounds={config.bounds.valuationHealthAbsoluteKrw}
                  step="any"
                  unit="KRW"
                  inputTestId="admin-settings-input-valuationHealthAbsoluteKrw"
                  onSave={(v) => patchAppConfigField("valuationHealthAbsoluteKrw", v)}
                />
              </div>
            </div>
          </Card>

          <Card data-testid="route-cache-policy-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Route cache policy</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Controls session route DTO TTLs and the stale-but-usable window for Dashboard, Portfolio, and Reports.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <label className="block text-sm font-medium text-slate-700" htmlFor="admin-settings-route-cache-policy-select">
                  Mode
                </label>
                <Select
                  value={routeCachePolicyMode || ROUTE_CACHE_POLICY_DEFAULT_SELECT_VALUE}
                  onValueChange={(value) => {
                    setRouteCachePolicyMode(
                      value === ROUTE_CACHE_POLICY_DEFAULT_SELECT_VALUE ? "" : value as RouteCachePolicyMode,
                    );
                    setRouteCacheModeError(null);
                    setRouteCacheModeSuccess(null);
                  }}
                  disabled={routeCacheModeSaving}
                >
                  <SelectTrigger
                    id="admin-settings-route-cache-policy-select"
                    className="w-full sm:w-72"
                    data-testid="admin-settings-route-cache-policy-select"
                  >
                    <SelectValue placeholder={`Use effective policy (${config.effectiveRouteCachePolicy.mode})`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ROUTE_CACHE_POLICY_DEFAULT_SELECT_VALUE}>Use effective policy ({config.effectiveRouteCachePolicy.mode})</SelectItem>
                      <SelectItem value="fresh">Fresh</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="low_load">Low load</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="grid gap-4 xl:grid-cols-2">
                  <NumericOverrideRow
                    fieldKey="routeCacheDashboardPrimaryTtlMs"
                    label="Dashboard primary TTL"
                    description="Fresh-cache TTL for dashboard primary DTOs."
                    override={config.routeCacheDashboardPrimaryTtlMs}
                    effective={config.effectiveRouteCachePolicy.dashboardPrimaryTtlMs}
                    bounds={config.bounds.routeCacheDashboardPrimaryTtlMs}
                    unit="ms"
                    inputTestId="admin-settings-input-routeCacheDashboardPrimaryTtlMs"
                    onSave={(v) => patchAppConfigField("routeCacheDashboardPrimaryTtlMs", v)}
                  />
                  <NumericOverrideRow
                    fieldKey="routeCacheDashboardEnrichmentTtlMs"
                    label="Dashboard enrichment TTL"
                    description="Fresh-cache TTL for dashboard hero/enrichment DTOs."
                    override={config.routeCacheDashboardEnrichmentTtlMs}
                    effective={config.effectiveRouteCachePolicy.dashboardEnrichmentTtlMs}
                    bounds={config.bounds.routeCacheDashboardEnrichmentTtlMs}
                    unit="ms"
                    inputTestId="admin-settings-input-routeCacheDashboardEnrichmentTtlMs"
                    onSave={(v) => patchAppConfigField("routeCacheDashboardEnrichmentTtlMs", v)}
                  />
                  <NumericOverrideRow
                    fieldKey="routeCacheDashboardPerformanceTtlMs"
                    label="Dashboard performance TTL"
                    description="Fresh-cache TTL for dashboard performance chart DTOs."
                    override={config.routeCacheDashboardPerformanceTtlMs}
                    effective={config.effectiveRouteCachePolicy.dashboardPerformanceTtlMs}
                    bounds={config.bounds.routeCacheDashboardPerformanceTtlMs}
                    unit="ms"
                    inputTestId="admin-settings-input-routeCacheDashboardPerformanceTtlMs"
                    onSave={(v) => patchAppConfigField("routeCacheDashboardPerformanceTtlMs", v)}
                  />
                  <NumericOverrideRow
                    fieldKey="routeCachePortfolioTtlMs"
                    label="Portfolio TTL"
                    description="Fresh-cache TTL for portfolio primary DTOs."
                    override={config.routeCachePortfolioTtlMs}
                    effective={config.effectiveRouteCachePolicy.portfolioTtlMs}
                    bounds={config.bounds.routeCachePortfolioTtlMs}
                    unit="ms"
                    inputTestId="admin-settings-input-routeCachePortfolioTtlMs"
                    onSave={(v) => patchAppConfigField("routeCachePortfolioTtlMs", v)}
                  />
                  <NumericOverrideRow
                    fieldKey="routeCacheReportsTtlMs"
                    label="Reports TTL"
                    description="Fresh-cache TTL for report DTOs."
                    override={config.routeCacheReportsTtlMs}
                    effective={config.effectiveRouteCachePolicy.reportsTtlMs}
                    bounds={config.bounds.routeCacheReportsTtlMs}
                    unit="ms"
                    inputTestId="admin-settings-input-routeCacheReportsTtlMs"
                    onSave={(v) => patchAppConfigField("routeCacheReportsTtlMs", v)}
                  />
                  <NumericOverrideRow
                    fieldKey="routeCacheStaleUsableTtlMs"
                    label="Stale-usable window"
                    description="Maximum age where cached DTOs may stay visible while background refresh runs."
                    override={config.routeCacheStaleUsableTtlMs}
                    effective={config.effectiveRouteCachePolicy.staleUsableTtlMs}
                    bounds={config.bounds.routeCacheStaleUsableTtlMs}
                    unit="ms"
                    inputTestId="admin-settings-input-routeCacheStaleUsableTtlMs"
                    onSave={(v) => patchAppConfigField("routeCacheStaleUsableTtlMs", v)}
                  />
                </div>
                {routeCacheModeError ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" data-testid="admin-settings-route-cache-policy-error">
                    {routeCacheModeError}
                  </p>
                ) : null}
                {routeCacheModeSuccess ? (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status" data-testid="admin-settings-route-cache-policy-success">
                    {routeCacheModeSuccess}
                  </p>
                ) : null}
                <div className="flex items-center justify-end">
                  <Button onClick={() => void handleSaveRouteCacheMode()} disabled={routeCacheModeSaving} data-testid="admin-settings-route-cache-policy-save">
                    {routeCacheModeSaving ? adminDict.common.saving : adminDict.common.save}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── API keys tab (Provider API keys) ────────────────────────────── */}
        <TabsContent value="api-keys" data-testid="admin-settings-panel-api-keys">
          {/* ── KZO-198: Provider Keys section (Tier 0 — masked) ─────────── */}
          <Card data-testid="admin-settings-provider-keys-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t("Provider API keys")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("Encrypted secrets stored in")} <code>app_config</code>{t(". Existing values are never displayed; rotate to replace, clear to fall back to the environment value. Audit log records the rotation event but never the secret.")}
                </p>
              </div>
              <MaskedSecretInput
                fieldKey="finmind-api-token"
                label={t("FinMind API token")}
                description={t("Bearer token used by the TWSE/FinMind data provider.")}
                isSet={config.finmindApiTokenSet}
                secretLengthBounds={config.secretLengthBounds}
                onRotate={(plaintext) => patchAppConfigField("finmindApiToken", plaintext)}
                onClear={() => patchAppConfigField("finmindApiToken", null)}
              />
              <MaskedSecretInput
                fieldKey="twelve-data-api-key"
                label={t("Twelve Data API key")}
                description={t("API key used by the AU catalog (Twelve Data) provider.")}
                isSet={config.twelveDataApiKeySet}
                secretLengthBounds={config.secretLengthBounds}
                onRotate={(plaintext) => patchAppConfigField("twelveDataApiKey", plaintext)}
                onClear={() => patchAppConfigField("twelveDataApiKey", null)}
              />
              <MaskedSecretInput
                fieldKey="eodhd-api-key"
                label={t("EODHD API key")}
                description={t("API key used by the EODHD end-of-day fallback provider.")}
                isSet={config.eodhdApiKeySet ?? false}
                secretLengthBounds={config.secretLengthBounds}
                onRotate={(plaintext) => patchAppConfigField("eodhdApiKey", plaintext)}
                onClear={() => patchAppConfigField("eodhdApiKey", null)}
              />
            </div>
          </Card>
          <Card data-testid="admin-settings-eodhd-budget-section">
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t("EODHD fallback budget")}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("Strict local guard for scheduled and manual fallback refreshes.")}
                </p>
              </div>
              <NumericOverrideRow
                fieldKey="eodhdDailyCallLimit"
                label={t("EODHD daily call limit")}
                description={t("Maximum EODHD calls the app may spend per day before refreshes are blocked locally.")}
                override={config.eodhdDailyCallLimit ?? null}
                effective={config.effectiveEodhdDailyCallLimit ?? 20}
                bounds={config.bounds.eodhdDailyCallLimit ?? { min: 1, max: 1_000 }}
                inputTestId="admin-settings-input-eodhdDailyCallLimit"
                onSave={(v) => patchAppConfigField("eodhdDailyCallLimit", v)}
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="mcp" data-testid="admin-settings-panel-mcp">
          <AdminMcpSettingsPanel active={activeTab === "mcp"} />
        </TabsContent>
          </div>
        </div>
      </TabsRoot>

      <p className="text-xs text-slate-500" data-testid="admin-settings-last-updated">
        {t("Last updated")} {formatTimestamp(config.updatedAt)} {t("· Change will be recorded in the audit log")}
      </p>
    </div>
  );
}
