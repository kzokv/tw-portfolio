import type {
  AdminMarketCode,
  AdminMarketCalendarActiveVersionDto,
  AdminMarketDataOverviewResponse,
  AdminMarketDataProviderChipDto,
  AdminMarketWorkspaceTab,
} from "@vakwen/shared-types";

export type AdminMarketWorkspaceUiTab = AdminMarketWorkspaceTab | "activity" | "calendar";

export interface AdminMarketDataOverviewUiResponse extends Omit<AdminMarketDataOverviewResponse, "tabs"> {
  tabs: AdminMarketWorkspaceUiTab[];
}

export type MarketActivityCategory =
  | "intraday_price"
  | "daily_close"
  | "calendar"
  | "provider_operation"
  | "system";

export type MarketActivityResult = "success" | "warning" | "error" | "skipped" | "rate_limited";

export interface MarketActivityFilterOption {
  value: string;
  label: string;
}

export interface MarketActivitySummaryCardDto {
  id: string;
  label: string;
  value: string | number;
  detail?: string | null;
  tone?: MarketActivityResult | "neutral";
  filterPatch?: Partial<AdminMarketDataActivityQuery>;
}

export interface YahooChartActivitySummaryDto {
  label: string;
  lastRequestAt?: string | null;
  successCount?: number | null;
  delayedCount?: number | null;
  rateLimitedCount?: number | null;
  errorCount?: number | null;
  budgetUsed?: number | null;
  budgetLimit?: number | null;
  filterPatch?: Partial<AdminMarketDataActivityQuery>;
}

export interface MarketActivityTableItemDto {
  id: string;
  occurredAt: string;
  category: MarketActivityCategory | string;
  source: string;
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceLabel?: string | null;
  subject: string;
  subjectDetail?: string | null;
  result: MarketActivityResult | string;
  facts: string;
  detailTitle?: string | null;
  detailDescription?: string | null;
  detailRows?: Array<{ label: string; value: string }>;
  timeline?: Array<{ at?: string | null; message: string }>;
  progressRows?: Array<{ label: string; value: string }>;
  outcomeRows?: Array<{ label: string; value: string }>;
  logRows?: Array<{ at?: string | null; message: string }>;
  relatedActivity?: Array<{ label: string; href?: string | null; value?: string | null }>;
  metadata?: Record<string, unknown> | null;
}

export interface AdminMarketDataActivityQuery {
  page: number;
  limit: number;
  search: string;
  source: string;
  sourceKind: string;
  sourceId: string;
  category: string;
  result: string;
  timeRange: string;
}

export interface AdminMarketDataActivityResponse {
  marketCode: AdminMarketCode;
  marketLabel?: string | null;
  providers: AdminMarketDataProviderChipDto[];
  summary: MarketActivitySummaryCardDto[];
  yahooChartSummary?: YahooChartActivitySummaryDto | null;
  availableFilters?: {
    sources?: MarketActivityFilterOption[];
    categories?: MarketActivityFilterOption[];
    results?: MarketActivityFilterOption[];
    timeRanges?: MarketActivityFilterOption[];
  } | null;
  retentionNote?: string | null;
  items: MarketActivityTableItemDto[];
  total: number;
  page: number;
  limit: number;
  query?: Partial<AdminMarketDataActivityQuery> | null;
}

export interface MarketCalendarCoverageYearDto {
  calendarYear: number;
  status: "confirmed" | "warning" | "missing" | "invalidated" | "pending" | string;
  sourceLabel?: string | null;
  sourceUrlHost?: string | null;
  versionLabel?: string | null;
  updatedAt?: string | null;
  note?: string | null;
}

export interface MarketCalendarSourceDto {
  sourceId: string;
  label: string;
  sourceType: string;
  suggestedSourceUrl?: string | null;
  isDefault?: boolean | null;
  isActive?: boolean | null;
  years?: number[] | null;
}

export interface MarketCalendarPreviewDiffDto {
  added: number;
  changed: number;
  removed: number;
  previewToken?: string | null;
  warnings?: string[] | null;
  confirmable: boolean;
  replaceConfirmedRequired?: boolean | null;
  rows: Array<{
    date: string;
    session: string;
    name?: string | null;
    evidence?: string | null;
  }>;
}

export interface MarketCalendarHistoryItemDto {
  id: string;
  importOperationId?: string | null;
  calendarYear: number;
  sourceLabel: string;
  importedAt: string;
  importedBy?: string | null;
  status: string;
  note?: string | null;
}

export interface AdminMarketDataCalendarResponse {
  marketCode: AdminMarketCode;
  marketLabel?: string | null;
  defaultSourceLabel?: string | null;
  defaultSourceHost?: string | null;
  years: MarketCalendarCoverageYearDto[];
  sources: MarketCalendarSourceDto[];
  activeCalendars?: AdminMarketCalendarActiveVersionDto[];
  preview?: MarketCalendarPreviewDiffDto | null;
  history: MarketCalendarHistoryItemDto[];
  statusNote?: string | null;
}

export interface MarketCalendarSourceUpdateRequest {
  defaultSourceId: string;
}

export interface MarketCalendarSourceConfigUpdateRequest {
  label: string;
  sourceType: "official_source" | "manual_ai_assisted";
  suggestedSourceUrl?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface MarketCalendarPreviewRequest {
  marketCode: AdminMarketCode;
  sourceId?: string;
  normalizedPayload?: string;
  replaceConfirmed?: boolean;
  replacementReason?: string | null;
}

export interface MarketCalendarPreviewResponse {
  marketCode: AdminMarketCode;
  preview: MarketCalendarPreviewDiffDto;
}

export interface MarketCalendarConfirmRequest {
  previewToken: string;
  marketCode: AdminMarketCode;
  sourceId?: string;
  normalizedPayload?: string;
  replaceConfirmed?: boolean;
  reason?: string;
  replacementReason?: string | null;
}

export interface MarketCalendarConfirmResponse {
  marketCode: AdminMarketCode;
  status: "queued" | "confirmed";
  versionId: string;
}

export interface MarketCalendarInvalidateRequest {
  calendarYear: number;
  reason: string;
}

export interface MarketCalendarInvalidateResponse {
  marketCode: AdminMarketCode;
  calendarYear: number;
  status: "invalidated";
}
