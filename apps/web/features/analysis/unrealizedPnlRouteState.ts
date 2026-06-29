import { ACCOUNT_DEFAULT_CURRENCIES, type AccountDefaultCurrency } from "@vakwen/shared-types";
import {
  ANALYSIS_GRANULARITIES,
  ANALYSIS_HOLDINGS_STATES,
  ANALYSIS_INSTRUMENT_TYPES,
  ANALYSIS_MARKET_CODES,
  ANALYSIS_RANGE_OPTIONS,
  ANALYSIS_SELECTION_MODES,
  ANALYSIS_VIEW_MODES,
  type AnalysisHoldingsState,
  type AnalysisInstrumentType,
  type AnalysisMarketCode,
  type AnalysisRangeOption,
  type AnalysisSelectionMode,
  type AnalysisViewMode,
  type UnrealizedPnlAnalysisRouteState,
} from "./unrealizedPnlTypes";

export const ANALYSIS_DEFAULT_STATE: UnrealizedPnlAnalysisRouteState = {
  range: "3M",
  from: null,
  to: null,
  granularity: "weekly",
  markets: [],
  accounts: [],
  tickers: [],
  selectionMode: "top-drivers",
  selected: [],
  lineCount: 5,
  holdingsState: "current-only",
  reportingCurrency: "TWD",
  includeProvisional: false,
  instrumentTypes: [],
  focusDate: null,
  view: "overview",
};

export const ANALYSIS_MAX_LINE_COUNT = 20;
const FIVE_YEAR_RANGES = new Set<AnalysisRangeOption>(["1M", "3M", "YTD", "1Y", "3Y", "5Y", "CUSTOM"]);

export interface UnrealizedPnlAnalysisExplicitPreferenceKeys {
  granularity: boolean;
  lineCount: boolean;
  holdingsState: boolean;
  reportingCurrency: boolean;
  includeProvisional: boolean;
}

export interface UnrealizedPnlAnalysisPresentationDefaults {
  granularity?: UnrealizedPnlAnalysisRouteState["granularity"];
  lineCount?: number;
  holdingsState?: UnrealizedPnlAnalysisRouteState["holdingsState"];
  reportingCurrency?: UnrealizedPnlAnalysisRouteState["reportingCurrency"];
  includeProvisional?: boolean;
}

export const EMPTY_ANALYSIS_EXPLICIT_PREFERENCE_KEYS: UnrealizedPnlAnalysisExplicitPreferenceKeys = {
  granularity: false,
  lineCount: false,
  holdingsState: false,
  reportingCurrency: false,
  includeProvisional: false,
};

export function getExplicitAnalysisPreferenceKeys(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): UnrealizedPnlAnalysisExplicitPreferenceKeys {
  const has = (key: string): boolean => {
    if (input instanceof URLSearchParams) return input.has(key);
    return input[key] !== undefined;
  };

  return {
    granularity: has("granularity"),
    lineCount: has("comparisonLineCount") || has("lines"),
    holdingsState: has("holdingsState") || has("holdings"),
    reportingCurrency: has("reportingCurrency") || has("currency"),
    includeProvisional: has("includeProvisional") || has("provisional"),
  };
}

export function parseAnalysisPresentationDefaults(value: unknown): UnrealizedPnlAnalysisPresentationDefaults | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const parsed: UnrealizedPnlAnalysisPresentationDefaults = {};

  if (typeof source.granularity === "string" && (ANALYSIS_GRANULARITIES as readonly string[]).includes(source.granularity)) {
    parsed.granularity = source.granularity as UnrealizedPnlAnalysisRouteState["granularity"];
  }
  if (typeof source.lineCount === "number" && Number.isFinite(source.lineCount)) {
    parsed.lineCount = Math.max(1, Math.min(ANALYSIS_MAX_LINE_COUNT, Math.trunc(source.lineCount)));
  }
  if (typeof source.holdingsState === "string" && (ANALYSIS_HOLDINGS_STATES as readonly string[]).includes(source.holdingsState)) {
    parsed.holdingsState = source.holdingsState as UnrealizedPnlAnalysisRouteState["holdingsState"];
  }
  if (typeof source.reportingCurrency === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(source.reportingCurrency)) {
    parsed.reportingCurrency = source.reportingCurrency as UnrealizedPnlAnalysisRouteState["reportingCurrency"];
  }
  if (typeof source.includeProvisional === "boolean") {
    parsed.includeProvisional = source.includeProvisional;
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

export function extractAnalysisPresentationDefaults(
  state: UnrealizedPnlAnalysisRouteState,
): Required<UnrealizedPnlAnalysisPresentationDefaults> {
  return {
    granularity: state.granularity,
    lineCount: state.lineCount,
    holdingsState: state.holdingsState,
    reportingCurrency: state.reportingCurrency,
    includeProvisional: state.includeProvisional,
  };
}

export function applyAnalysisPresentationDefaults(
  state: UnrealizedPnlAnalysisRouteState,
  defaults: UnrealizedPnlAnalysisPresentationDefaults,
  explicitKeys: UnrealizedPnlAnalysisExplicitPreferenceKeys,
): UnrealizedPnlAnalysisRouteState {
  const next: UnrealizedPnlAnalysisRouteState = { ...state };
  if (!explicitKeys.granularity && defaults.granularity) {
    next.granularity = defaults.granularity;
    if (next.range === "ALL" && defaults.granularity !== "yearly") {
      next.range = "5Y";
    }
  }
  if (!explicitKeys.lineCount && typeof defaults.lineCount === "number") next.lineCount = defaults.lineCount;
  if (!explicitKeys.holdingsState && defaults.holdingsState) next.holdingsState = defaults.holdingsState;
  if (!explicitKeys.reportingCurrency && defaults.reportingCurrency) next.reportingCurrency = defaults.reportingCurrency;
  if (!explicitKeys.includeProvisional && typeof defaults.includeProvisional === "boolean") {
    next.includeProvisional = defaults.includeProvisional;
  }
  return next;
}

export function parseUnrealizedPnlRouteState(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): UnrealizedPnlAnalysisRouteState {
  const read = (key: string): string | undefined => {
    if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
    const value = input[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const granularity = normalizeEnum(read("granularity"), ANALYSIS_GRANULARITIES, ANALYSIS_DEFAULT_STATE.granularity);
  let range = normalizeEnum(read("range"), ANALYSIS_RANGE_OPTIONS, ANALYSIS_DEFAULT_STATE.range);
  if (range === "ALL" && granularity !== "yearly") {
    range = "5Y";
  }
  if (granularity !== "yearly" && !FIVE_YEAR_RANGES.has(range)) {
    range = ANALYSIS_DEFAULT_STATE.range;
  }

  const from = normalizeDate(read("fromDate") ?? read("from"));
  const to = normalizeDate(read("toDate") ?? read("to"));
  const selectionMode = normalizeSelectionMode(read("selectionMode") ?? read("selection"));
  const selected = normalizeSelectedRefs(read("selectedTickers") ?? read("selected"));

  return {
    range,
    from: range === "CUSTOM" ? from : null,
    to: range === "CUSTOM" ? to : null,
    granularity,
    markets: normalizeCsv(read("markets")).filter(isMarketCode),
    accounts: normalizeCsv(read("accountIds") ?? read("accounts")),
    tickers: normalizeCsv(read("tickers")).map((ticker) => ticker.toUpperCase()),
    selectionMode,
    selected,
    lineCount: normalizeLineCount(read("comparisonLineCount") ?? read("lines")),
    holdingsState: normalizeHoldingsState(read("holdingsState") ?? read("holdings")),
    reportingCurrency: normalizeCurrency(read("reportingCurrency") ?? read("currency")),
    includeProvisional: read("includeProvisional") === "true" || read("provisional") === "1",
    instrumentTypes: normalizeCsv(read("instrumentTypes")).filter(isInstrumentType),
    focusDate: normalizeDate(read("focus")),
    view: normalizeEnum(read("view"), ANALYSIS_VIEW_MODES, ANALYSIS_DEFAULT_STATE.view),
  };
}

export function unrealizedPnlRouteStateToSearchParams(
  state: UnrealizedPnlAnalysisRouteState,
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.range !== ANALYSIS_DEFAULT_STATE.range) params.set("range", state.range);
  if (state.range === "CUSTOM") {
    if (state.from) params.set("fromDate", state.from);
    if (state.to) params.set("toDate", state.to);
  }
  if (state.granularity !== ANALYSIS_DEFAULT_STATE.granularity) params.set("granularity", state.granularity);
  if (state.markets.length > 0) params.set("markets", state.markets.join(","));
  if (state.accounts.length > 0) params.set("accountIds", state.accounts.join(","));
  if (state.tickers.length > 0) params.set("tickers", state.tickers.join(","));
  if (state.selectionMode !== ANALYSIS_DEFAULT_STATE.selectionMode) params.set("selectionMode", toApiSelectionMode(state.selectionMode));
  if (state.selected.length > 0) params.set("selectedTickers", state.selected.join(","));
  if (state.lineCount !== ANALYSIS_DEFAULT_STATE.lineCount) params.set("comparisonLineCount", String(state.lineCount));
  if (state.holdingsState !== ANALYSIS_DEFAULT_STATE.holdingsState) params.set("holdingsState", toApiHoldingsState(state.holdingsState));
  if (state.reportingCurrency !== ANALYSIS_DEFAULT_STATE.reportingCurrency) params.set("reportingCurrency", state.reportingCurrency);
  if (state.includeProvisional) params.set("includeProvisional", "true");
  if (state.instrumentTypes.length > 0) params.set("instrumentTypes", state.instrumentTypes.join(","));
  if (state.focusDate) params.set("focus", state.focusDate);
  if (state.view !== ANALYSIS_DEFAULT_STATE.view) params.set("view", state.view);

  return params;
}

export function buildUnrealizedPnlApiPath(state: UnrealizedPnlAnalysisRouteState): string {
  const params = unrealizedPnlRouteStateToSearchParams(state);
  return `/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export function buildUnrealizedPnlRoutePath(
  overrides: Partial<UnrealizedPnlAnalysisRouteState> = {},
): string {
  return buildUnrealizedPnlApiPath({
    ...ANALYSIS_DEFAULT_STATE,
    ...overrides,
    markets: overrides.markets ?? ANALYSIS_DEFAULT_STATE.markets,
    accounts: overrides.accounts ?? ANALYSIS_DEFAULT_STATE.accounts,
    tickers: overrides.tickers ?? ANALYSIS_DEFAULT_STATE.tickers,
    selected: overrides.selected ?? ANALYSIS_DEFAULT_STATE.selected,
    instrumentTypes: overrides.instrumentTypes ?? ANALYSIS_DEFAULT_STATE.instrumentTypes,
  });
}

export function mapPerformanceRangeToAnalysisRange(range: string): AnalysisRangeOption {
  if (range === "1M" || range === "3M" || range === "YTD" || range === "1Y" || range === "3Y" || range === "5Y" || range === "ALL") {
    return range;
  }

  const match = /^([1-9]\d*)([MY])$/.exec(range);
  if (!match) return ANALYSIS_DEFAULT_STATE.range;

  const count = Number.parseInt(match[1]!, 10);
  const unit = match[2];
  if (unit === "M") {
    if (count <= 1) return "1M";
    if (count <= 3) return "3M";
    if (count <= 12) return "1Y";
    if (count <= 36) return "3Y";
    return "5Y";
  }

  if (count <= 1) return "1Y";
  if (count <= 3) return "3Y";
  return "5Y";
}

function normalizeEnum<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = value?.trim();
  if (normalized && (allowed as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }
  return fallback;
}

function normalizeCsv(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeLineCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return ANALYSIS_DEFAULT_STATE.lineCount;
  return Math.max(1, Math.min(ANALYSIS_MAX_LINE_COUNT, parsed));
}

function normalizeCurrency(value: string | undefined): AccountDefaultCurrency {
  return typeof value === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(value)
    ? value as AccountDefaultCurrency
    : ANALYSIS_DEFAULT_STATE.reportingCurrency;
}

function normalizeSelectionMode(value: string | undefined): AnalysisSelectionMode {
  if (value === "auto") return "top-drivers";
  return normalizeEnum(value, ANALYSIS_SELECTION_MODES, ANALYSIS_DEFAULT_STATE.selectionMode);
}

function normalizeHoldingsState(value: string | undefined): AnalysisHoldingsState {
  if (value === "open_only") return "current-only";
  if (value === "include_sold_out") return "include-sold";
  return normalizeEnum(value, ANALYSIS_HOLDINGS_STATES, ANALYSIS_DEFAULT_STATE.holdingsState);
}

function normalizeSelectedRefs(value: string | undefined): string[] {
  return normalizeCsv(value).map((item) => {
    const [marketCode, ticker] = item.split(":");
    if (marketCode && ticker) return `${marketCode}:${ticker.toUpperCase()}`;
    return item.toUpperCase();
  });
}

function toApiSelectionMode(value: AnalysisSelectionMode): "auto" | "manual" {
  return value === "manual" ? "manual" : "auto";
}

function toApiHoldingsState(value: AnalysisHoldingsState): "open_only" | "include_sold_out" {
  return value === "include-sold" ? "include_sold_out" : "open_only";
}

function normalizeDate(value: string | undefined): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value ?? null : null;
}

function isMarketCode(value: string): value is AnalysisMarketCode {
  return (ANALYSIS_MARKET_CODES as readonly string[]).includes(value);
}

function isInstrumentType(value: string): value is AnalysisInstrumentType {
  return (ANALYSIS_INSTRUMENT_TYPES as readonly string[]).includes(value);
}

export function buildSelectedSeriesId(marketCode: string, ticker: string): string {
  return `${marketCode}:${ticker.toUpperCase()}`;
}

export function updateAnalysisSelection(
  current: UnrealizedPnlAnalysisRouteState,
  selected: string[],
  mode: AnalysisSelectionMode = "manual",
): UnrealizedPnlAnalysisRouteState {
  return {
    ...current,
    selectionMode: mode,
    selected: Array.from(new Set(selected)).sort((left, right) => left.localeCompare(right)),
  };
}

export function setAnalysisFocusDate(
  current: UnrealizedPnlAnalysisRouteState,
  focusDate: string | null,
): UnrealizedPnlAnalysisRouteState {
  return {
    ...current,
    focusDate,
  };
}

export function setAnalysisViewMode(
  current: UnrealizedPnlAnalysisRouteState,
  view: AnalysisViewMode,
): UnrealizedPnlAnalysisRouteState {
  return {
    ...current,
    view,
  };
}
