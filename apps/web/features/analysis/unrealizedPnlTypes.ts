import type { AccountDefaultCurrency, CurrencyCode } from "@vakwen/shared-types";

export const ANALYSIS_RANGE_OPTIONS = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL", "CUSTOM"] as const;
export type AnalysisRangeOption = (typeof ANALYSIS_RANGE_OPTIONS)[number];

export const ANALYSIS_GRANULARITIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type AnalysisGranularity = (typeof ANALYSIS_GRANULARITIES)[number];

export const ANALYSIS_SELECTION_MODES = ["top-drivers", "manual"] as const;
export type AnalysisSelectionMode = (typeof ANALYSIS_SELECTION_MODES)[number];

export const ANALYSIS_HOLDINGS_STATES = ["current-only", "include-sold"] as const;
export type AnalysisHoldingsState = (typeof ANALYSIS_HOLDINGS_STATES)[number];

export const ANALYSIS_VIEW_MODES = ["overview", "compare", "ticker-detail"] as const;
export type AnalysisViewMode = (typeof ANALYSIS_VIEW_MODES)[number];

export const ANALYSIS_MARKET_CODES = ["TW", "US", "AU", "KR", "JP"] as const;
export type AnalysisMarketCode = (typeof ANALYSIS_MARKET_CODES)[number];

export const ANALYSIS_INSTRUMENT_TYPES = ["STOCK", "ETF", "BOND_ETF"] as const;
export type AnalysisInstrumentType = (typeof ANALYSIS_INSTRUMENT_TYPES)[number];

export const ANALYSIS_MARKER_TYPES = ["buy", "partial-sell", "full-exit", "aggregate"] as const;
export type AnalysisMarkerType = (typeof ANALYSIS_MARKER_TYPES)[number];

export interface UnrealizedPnlAnalysisRouteState {
  range: AnalysisRangeOption;
  from: string | null;
  to: string | null;
  granularity: AnalysisGranularity;
  markets: AnalysisMarketCode[];
  accounts: string[];
  tickers: string[];
  selectionMode: AnalysisSelectionMode;
  selected: string[];
  lineCount: number;
  holdingsState: AnalysisHoldingsState;
  reportingCurrency: AccountDefaultCurrency;
  includeProvisional: boolean;
  instrumentTypes: AnalysisInstrumentType[];
  focusDate: string | null;
  view: AnalysisViewMode;
}

export interface AnalysisFilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface UnrealizedPnlAnalysisResolvedFilters {
  range: AnalysisRangeOption;
  from: string | null;
  to: string | null;
  granularity: AnalysisGranularity;
  markets: AnalysisMarketCode[];
  accounts: string[];
  tickers: string[];
  selectionMode: AnalysisSelectionMode;
  selected: string[];
  lineCount: number;
  holdingsState: AnalysisHoldingsState;
  reportingCurrency: CurrencyCode | AccountDefaultCurrency;
  includeProvisional: boolean;
  instrumentTypes: AnalysisInstrumentType[];
}

export interface UnrealizedPnlFilterOptions {
  markets: AnalysisFilterOption[];
  accounts: AnalysisFilterOption[];
  tickers: AnalysisFilterOption[];
  reportingCurrencies: AnalysisFilterOption[];
  instrumentTypes: AnalysisFilterOption[];
}

export interface UnrealizedPnlSummaryDriver {
  label: string;
  marketCode: string;
  ticker: string;
  periodChange: number;
}

export interface UnrealizedPnlSummaryCard {
  label: string;
  value: number | null;
  currency: CurrencyCode | AccountDefaultCurrency;
  tone?: "positive" | "negative" | "neutral";
  detail: string;
}

export interface UnrealizedPnlSummarySection {
  totalUnrealized: UnrealizedPnlSummaryCard;
  periodChange: UnrealizedPnlSummaryCard;
  bestDriver: UnrealizedPnlSummaryDriver | null;
  worstDriver: UnrealizedPnlSummaryDriver | null;
}

export interface UnrealizedPnlDataHealth {
  status: "complete" | "partial" | "pending";
  title: string;
  detail: string;
  provisionalIncluded: boolean;
  stalePriceCount: number;
  missingPriceCount: number;
  source: "api" | "preview";
}

export interface UnrealizedPnlPointMarker {
  date: string;
  type: AnalysisMarkerType;
  label: string;
}

export interface UnrealizedPnlSeriesPoint {
  date: string;
  unrealizedPnl: number | null;
  marketValue: number | null;
  costBasis: number | null;
  quantity: number;
  closePrice?: number | null;
  transactionContext: string;
}

export interface UnrealizedPnlSeries {
  seriesId: string;
  ticker: string;
  marketCode: AnalysisMarketCode;
  displayName: string;
  currency: CurrencyCode | AccountDefaultCurrency;
  instrumentType: AnalysisInstrumentType;
  stateLabel: string;
  state: "current" | "sold-out";
  colorToken: string;
  endUnrealizedPnl: number | null;
  periodChange: number | null;
  accountIds: string[];
  points: UnrealizedPnlSeriesPoint[];
  markers: UnrealizedPnlPointMarker[];
}

export interface UnrealizedPnlRankingRow {
  seriesId: string;
  ticker: string;
  marketCode: AnalysisMarketCode;
  displayName: string;
  stateLabel: string;
  state: "current" | "sold-out";
  endUnrealizedPnl: number | null;
  periodChange: number | null;
  isSelected: boolean;
}

export interface UnrealizedPnlReportsPreview {
  currentUnrealized: number | null;
  topGainLabel: string | null;
  topGainValue: number | null;
  topLossLabel: string | null;
  topLossValue: number | null;
  openHref: string;
}

export interface UnrealizedPnlAnalysisDto {
  query: UnrealizedPnlAnalysisResolvedFilters;
  availableFilters: UnrealizedPnlFilterOptions;
  summary: UnrealizedPnlSummarySection;
  dataHealth: UnrealizedPnlDataHealth;
  portfolioSeries: Array<{
    date: string;
    unrealizedPnl: number | null;
  }>;
  tickerSeries: UnrealizedPnlSeries[];
  ranking: UnrealizedPnlRankingRow[];
  selectedSeriesIds: string[];
  reportsPreview: UnrealizedPnlReportsPreview;
  deepLink: string;
  generatedAt: string;
}
