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
  Database,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Link2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  type AiConnectorPolicySettingsDto,
  type AppConfigDto,
  type RouteCachePolicyMode,
  type TickerPriceFreshnessAppConfigDto,
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
import { SortableRangeList, type SortableRangeRow } from "../settings/SortableRangeList";
import { NumericOverrideRow } from "./NumericOverrideRow";
import { MaskedSecretInput } from "./MaskedSecretInput";
import { useAdminI18n } from "./admin-i18n";

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
  | "maxConnectorLifetimeDays";

const MCP_NUMERIC_FIELDS: Array<{
  key: McpNumericSettingKey;
  label: string;
  min: number;
  max: number;
}> = [
  { key: "maxActiveConnectionsPerUser", label: "Max active connectors", min: 1, max: 20 },
  { key: "inactivityExpiryDays", label: "Inactivity expiry days", min: 1, max: 365 },
  { key: "expirationWarningDays", label: "Expiry warning days", min: 1, max: 30 },
  { key: "maxConnectorLifetimeDays", label: "Max connector lifetime days", min: 1, max: 365 },
];

function numericDraftsFromSettings(
  settings: AiConnectorPolicySettingsDto,
): Record<McpNumericSettingKey, string> {
  return {
    maxActiveConnectionsPerUser: String(settings.maxActiveConnectionsPerUser),
    inactivityExpiryDays: String(settings.inactivityExpiryDays),
    expirationWarningDays: String(settings.expirationWarningDays),
    maxConnectorLifetimeDays: String(settings.maxConnectorLifetimeDays),
  };
}

function parseMcpNumericDrafts(
  drafts: Record<McpNumericSettingKey, string>,
): Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey> {
  return Object.fromEntries(MCP_NUMERIC_FIELDS.map((field) => {
    const value = Number(drafts[field.key]);
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      throw new Error(`${field.label} must be an integer from ${field.min} to ${field.max}.`);
    }
    return [field.key, value];
  })) as Pick<AiConnectorPolicySettingsDto, McpNumericSettingKey>;
}

const MCP_REDIRECT_ALLOWLIST_EXAMPLES = [
  "https://chatgpt.com/connector/oauth/<connector-id>",
  "https://chat.openai.com/connector/oauth/<connector-id>",
  "https://chatgpt.com/aip/oauth/callback",
  "https://chatgpt.com/aip/<gpt-id>/oauth/callback",
] as const;

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
  effectiveSupportedMarkets: ["TW", "US", "AU", "KR"],
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
  options: {
    supportedMarkets: ["TW", "US", "AU", "KR"],
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
>;

function buildTickerPriceFreshnessPatch(
  draft: TickerPriceFreshnessAppConfigDto,
): TickerPriceFreshnessPatchDto {
  return {
    closeRefreshGraceMinutes: draft.closeRefreshGraceMinutes,
    intradayEnabled: draft.intradayEnabled,
    intradayRefreshIntervalMinutes: draft.intradayRefreshIntervalMinutes,
    intradayFreshnessToleranceMinutes: draft.intradayFreshnessToleranceMinutes,
    yahooChartRequestLimitPerMinute: draft.yahooChartRequestLimitPerMinute,
    queueConcurrency: draft.queueConcurrency,
    maxTickersPerRefreshCycle: draft.maxTickersPerRefreshCycle,
    supportedMarkets: draft.supportedMarkets,
    regularSessionOnly: draft.regularSessionOnly,
    yahooChartRange: draft.yahooChartRange,
    yahooChartInterval: draft.yahooChartInterval,
    refreshCloseRateLimitWindowMs: draft.refreshCloseRateLimitWindowMs,
    refreshCloseRateLimitMax: draft.refreshCloseRateLimitMax,
    syncTickerCap: draft.syncTickerCap,
  };
}

function parseNullableNumberInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const [draft, setDraft] = useState<TickerPriceFreshnessAppConfigDto>(config.tickerPriceFreshness ?? DEFAULT_TICKER_PRICE_FRESHNESS_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config.tickerPriceFreshness ?? DEFAULT_TICKER_PRICE_FRESHNESS_SETTINGS);
  }, [config]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await patchJson<AppConfigDto>(
        "/admin/settings",
        { tickerPriceFreshness: buildTickerPriceFreshnessPatch(draft) },
      );
      onUpdated(updated);
      setSuccess(isZhTW ? "價格新鮮度設定已儲存。" : "Ticker price freshness settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : isZhTW ? "無法儲存價格新鮮度設定。" : "Failed to save ticker price freshness settings.");
    } finally {
      setSaving(false);
    }
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
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "收盤寬限（分鐘）" : "Close grace minutes"}
            <input data-testid="admin-settings-input-tickerPriceCloseRefreshGraceMinutes" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.closeRefreshGraceMinutes ?? ""} onChange={(event) => setDraft((current) => ({ ...current, closeRefreshGraceMinutes: parseNullableNumberInput(event.target.value) }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "同步刷新上限" : "Sync ticker cap"}
            <input className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.syncTickerCap ?? ""} onChange={(event) => setDraft((current) => ({ ...current, syncTickerCap: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "盤中刷新間隔（分鐘）" : "Intraday refresh interval (minutes)"}
            <input className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.intradayRefreshIntervalMinutes ?? ""} onChange={(event) => setDraft((current) => ({ ...current, intradayRefreshIntervalMinutes: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "新鮮度容忍（分鐘）" : "Freshness tolerance (minutes)"}
            <input className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.intradayFreshnessToleranceMinutes ?? ""} onChange={(event) => setDraft((current) => ({ ...current, intradayFreshnessToleranceMinutes: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "Yahoo 每分鐘請求上限" : "Yahoo requests per minute"}
            <input className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.yahooChartRequestLimitPerMinute ?? ""} onChange={(event) => setDraft((current) => ({ ...current, yahooChartRequestLimitPerMinute: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "佇列並行數" : "Queue concurrency"}
            <input className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.queueConcurrency ?? ""} onChange={(event) => setDraft((current) => ({ ...current, queueConcurrency: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "每輪最大代號數" : "Max tickers per cycle"}
            <input className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.maxTickersPerRefreshCycle ?? ""} onChange={(event) => setDraft((current) => ({ ...current, maxTickersPerRefreshCycle: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "刷新視窗（毫秒）" : "Refresh endpoint window (ms)"}
            <input data-testid="admin-settings-input-tickerPriceRefreshCloseRateLimitWindowMs" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.refreshCloseRateLimitWindowMs ?? ""} onChange={(event) => setDraft((current) => ({ ...current, refreshCloseRateLimitWindowMs: Number(event.target.value) || null }))} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "刷新請求上限" : "Refresh endpoint max requests"}
            <input data-testid="admin-settings-input-tickerPriceRefreshCloseRateLimitMax" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2" type="number" value={draft.refreshCloseRateLimitMax ?? ""} onChange={(event) => setDraft((current) => ({ ...current, refreshCloseRateLimitMax: Number(event.target.value) || null }))} />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "Yahoo range" : "Yahoo chart range"}
            <Select value={draft.yahooChartRange ?? draft.effectiveYahooChartRange} onValueChange={(value: "1d" | "5d") => setDraft((current) => ({ ...current, yahooChartRange: value }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">1d</SelectItem>
                <SelectItem value="5d">5d</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            {isZhTW ? "Yahoo interval" : "Yahoo chart interval"}
            <Select value={draft.yahooChartInterval ?? draft.effectiveYahooChartInterval} onValueChange={(value: "1m" | "2m" | "5m" | "15m") => setDraft((current) => ({ ...current, yahooChartInterval: value }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1m">1m</SelectItem>
                <SelectItem value="2m">2m</SelectItem>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="15m">15m</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
            <span className="font-medium text-slate-800">{isZhTW ? "啟用盤中刷新" : "Enable intraday refresh"}</span>
            <input type="checkbox" checked={draft.intradayEnabled ?? draft.effectiveIntradayEnabled} onChange={(event) => setDraft((current) => ({ ...current, intradayEnabled: event.target.checked }))} />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
            <span className="font-medium text-slate-800">{isZhTW ? "僅常規時段" : "Regular session only"}</span>
            <input type="checkbox" checked={draft.regularSessionOnly ?? draft.effectiveRegularSessionOnly} onChange={(event) => setDraft((current) => ({ ...current, regularSessionOnly: event.target.checked }))} />
          </label>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{isZhTW ? "支援市場" : "Supported markets"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["TW", "US", "AU", "KR"] as const).map((market) => {
              const selected = (draft.supportedMarkets ?? draft.effectiveSupportedMarkets).includes(market);
              return (
                <button
                  key={market}
                  type="button"
                  className={cn("rounded-full border px-3 py-1.5 text-sm", selected ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-slate-700")}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    supportedMarkets: selected
                      ? (current.supportedMarkets ?? current.effectiveSupportedMarkets).filter((item) => item !== market)
                      : [...(current.supportedMarkets ?? current.effectiveSupportedMarkets), market],
                  }))}
                >
                  {market}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void save()} disabled={saving} data-testid="admin-settings-save-ticker-price-freshness">
            {saving ? (isZhTW ? "儲存中..." : "Saving...") : (isZhTW ? "儲存價格新鮮度設定" : "Save freshness settings")}
          </Button>
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
      setSuccess("MCP settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save MCP settings.");
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
          {error ?? (isZhTW ? "MCP 設定載入中..." : "Loading MCP settings...")}
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
    numericValidation = err instanceof Error ? err.message : "Numeric MCP settings are invalid.";
  }
  const numericDirty = MCP_NUMERIC_FIELDS.some((field) => currentNumericDrafts[field.key] !== String(settings[field.key]));
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
          {(["read", "drafts", "write"] as const).map((group) => (
            <label key={group} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <span className="font-medium capitalize text-slate-800">
                {isZhTW
                  ? `${group === "read" ? "讀取" : group === "drafts" ? "草稿" : "寫入"}工具`
                  : `${group} tools`}
              </span>
              <input
                type="checkbox"
                checked={settings.groupToggles[group]}
                disabled={saving}
                onChange={(event) => void save({ groupToggles: { ...settings.groupToggles, [group]: event.target.checked } })}
              />
            </label>
          ))}
        </div>

        {allGroupsDisabled ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
            {isZhTW
              ? "所有 MCP 工具群組都已停用。新的 ChatGPT 同意授權會被封鎖，使用者連接器權限控制也會保持停用，直到管理員重新啟用至少一個群組。"
              : "All MCP tool groups are disabled. New ChatGPT consent approvals are blocked and user connector scope controls stay disabled until an admin re-enables at least one group."}
          </p>
        ) : null}

        <div className="rounded-xl border border-slate-200 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-3">
            {MCP_NUMERIC_FIELDS.map((field) => (
              <label key={field.key} className="text-sm font-medium text-slate-700">
                {isZhTW
                  ? ({
                    maxActiveConnectionsPerUser: "最大啟用連接器數",
                    inactivityExpiryDays: "閒置到期天數",
                    expirationWarningDays: "到期警告天數",
                    maxConnectorLifetimeDays: "連接器最長有效天數",
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
              {MCP_REDIRECT_ALLOWLIST_EXAMPLES.map((example) => (
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
