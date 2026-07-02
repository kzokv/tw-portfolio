import { ACCOUNT_DEFAULT_CURRENCIES, type AccountDefaultCurrency } from "@vakwen/shared-types";
import {
  ANALYSIS_DETAIL_LAYOUTS,
  ANALYSIS_DRIVER_COUNTS,
  ANALYSIS_GRANULARITIES,
  ANALYSIS_INSTRUMENT_TYPES,
  ANALYSIS_MARKET_CODES,
  ANALYSIS_POSITION_STATUSES,
  ANALYSIS_RANGE_OPTIONS,
  ANALYSIS_SELECTIONS,
  ANALYSIS_TICKER_MODES,
  ANALYSIS_VIEW_MODES,
  type AnalysisDetailLayout,
  type AnalysisDriverCount,
  type AnalysisGranularity,
  type AnalysisInstrumentType,
  type AnalysisMarketCode,
  type AnalysisPositionStatus,
  type AnalysisRangeOption,
  type AnalysisSelection,
  type AnalysisTickerMode,
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
  selection: "topDrivers",
  tickerMode: "allEligible",
  tickerIds: [],
  drivers: 5,
  positionStatus: "openOnly",
  reportingCurrency: "TWD",
  includeProvisional: false,
  instrumentTypes: [],
  detailLayout: "responsive",
  focusDate: null,
  view: "overview",
};

export const ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY = "analysisUnrealizedPnlSettings";
export const LEGACY_ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY = "analysisUnrealizedPnlDefaults";
export const ANALYSIS_CANDIDATE_SAFETY_CAP = 200;
const FIVE_YEAR_RANGES = new Set<AnalysisRangeOption>(["1M", "3M", "YTD", "1Y", "3Y", "5Y", "CUSTOM"]);

export interface UnrealizedPnlAnalysisExplicitPreferenceKeys {
  selection: boolean;
  granularity: boolean;
  drivers: boolean;
  positionStatus: boolean;
  tickerMode: boolean;
  tickerIds: boolean;
  reportingCurrency: boolean;
  includeProvisional: boolean;
}

export interface UnrealizedPnlAnalysisModeSettings {
  positionStatus: AnalysisPositionStatus;
  tickerMode: AnalysisTickerMode;
  tickerIds: string[];
  drivers?: AnalysisDriverCount;
}

export interface UnrealizedPnlAnalysisSettings {
  version: 1;
  selection: AnalysisSelection;
  granularity: AnalysisGranularity;
  reportingCurrency: AccountDefaultCurrency;
  includeProvisional: boolean;
  detailLayout: AnalysisDetailLayout;
  topDrivers: UnrealizedPnlAnalysisModeSettings & { drivers: AnalysisDriverCount };
  manualTickers: UnrealizedPnlAnalysisModeSettings;
}

export const EMPTY_ANALYSIS_EXPLICIT_PREFERENCE_KEYS: UnrealizedPnlAnalysisExplicitPreferenceKeys = {
  selection: false,
  granularity: false,
  drivers: false,
  positionStatus: false,
  tickerMode: false,
  tickerIds: false,
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
    selection: has("selection") || has("selectionMode"),
    granularity: has("granularity"),
    drivers: has("drivers") || has("comparisonLineCount") || has("lines"),
    positionStatus: has("positionStatus") || has("holdingsState") || has("holdings"),
    tickerMode: has("tickerMode") || has("tickerIds") || has("selectedTickers") || has("selected") || has("tickers"),
    tickerIds: has("tickerIds") || has("selectedTickers") || has("selected") || has("tickers"),
    reportingCurrency: has("reportingCurrency") || has("currency"),
    includeProvisional: has("includeProvisional") || has("provisional"),
  };
}

export function parseAnalysisSettings(value: unknown): UnrealizedPnlAnalysisSettings {
  const defaults = settingsFromState(ANALYSIS_DEFAULT_STATE);
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const selection = normalizeEnum(asString(source.selection), ANALYSIS_SELECTIONS, defaults.selection);
  const topDrivers = ensureTopDriversSettings(repairModeSettings(source.topDrivers, defaults.topDrivers, true));
  const manualTickers = repairModeSettings(source.manualTickers, defaults.manualTickers, false);

  return {
    version: 1,
    selection,
    granularity: normalizeEnum(asString(source.granularity), ANALYSIS_GRANULARITIES, defaults.granularity),
    reportingCurrency: normalizeCurrency(asString(source.reportingCurrency), defaults.reportingCurrency),
    includeProvisional: typeof source.includeProvisional === "boolean" ? source.includeProvisional : defaults.includeProvisional,
    detailLayout: normalizeEnum(asString(source.detailLayout), ANALYSIS_DETAIL_LAYOUTS, defaults.detailLayout),
    topDrivers,
    manualTickers,
  };
}

export function parseAnalysisSettingsFromPreferences(
  preferences: Record<string, unknown> | undefined,
): UnrealizedPnlAnalysisSettings {
  const rawSettings = preferences?.[ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY]
    ?? parseLegacyAnalysisSettings(preferences?.[LEGACY_ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY]);
  const parsed = parseAnalysisSettings(rawSettings);
  const reportingCurrencyOmitted = !rawSettings
    || typeof rawSettings !== "object"
    || Array.isArray(rawSettings)
    || !Object.prototype.hasOwnProperty.call(rawSettings, "reportingCurrency");
  if (
    reportingCurrencyOmitted
    && parsed.reportingCurrency === ANALYSIS_DEFAULT_STATE.reportingCurrency
    && typeof preferences?.reportingCurrency === "string"
    && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(preferences.reportingCurrency)
  ) {
    return { ...parsed, reportingCurrency: preferences.reportingCurrency as AccountDefaultCurrency };
  }
  return parsed;
}

function parseLegacyAnalysisSettings(value: unknown): Partial<UnrealizedPnlAnalysisSettings> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const defaults = settingsFromState(ANALYSIS_DEFAULT_STATE);
  const drivers = typeof source.lineCount === "number" && Number.isFinite(source.lineCount)
    ? normalizeLegacyDriverCount(source.lineCount, defaults.topDrivers.drivers)
    : defaults.topDrivers.drivers;
  const positionStatus = source.holdingsState === "include-sold" || source.holdingsState === "include-sold-out"
    ? "includeClosed"
    : defaults.topDrivers.positionStatus;

  const settings: Partial<UnrealizedPnlAnalysisSettings> = {
    version: 1,
    selection: defaults.selection,
    granularity: normalizeEnum(asString(source.granularity), ANALYSIS_GRANULARITIES, defaults.granularity),
    includeProvisional: typeof source.includeProvisional === "boolean" ? source.includeProvisional : defaults.includeProvisional,
    detailLayout: defaults.detailLayout,
    topDrivers: {
      ...defaults.topDrivers,
      drivers,
      positionStatus,
    },
    manualTickers: {
      ...defaults.manualTickers,
      positionStatus,
    },
  };
  if (typeof source.reportingCurrency === "string") {
    settings.reportingCurrency = normalizeCurrency(source.reportingCurrency, defaults.reportingCurrency);
  }
  return settings;
}

export function settingsFromState(state: UnrealizedPnlAnalysisRouteState): UnrealizedPnlAnalysisSettings {
  const topDrivers = ensureTopDriversSettings(
    state.selection === "topDrivers"
      ? modeSettingsFromState(state, true)
      : modeSettingsFromState({ ...ANALYSIS_DEFAULT_STATE, selection: "topDrivers" }, true),
  );
  const manualTickers = state.selection === "manualTickers"
    ? modeSettingsFromState(state, false)
    : modeSettingsFromState({ ...ANALYSIS_DEFAULT_STATE, selection: "manualTickers" }, false);

  return {
    version: 1,
    selection: state.selection,
    granularity: state.granularity,
    reportingCurrency: state.reportingCurrency,
    includeProvisional: state.includeProvisional,
    detailLayout: state.detailLayout,
    topDrivers,
    manualTickers,
  };
}

export function mergeSettingsWithState(
  previous: UnrealizedPnlAnalysisSettings,
  state: UnrealizedPnlAnalysisRouteState,
): UnrealizedPnlAnalysisSettings {
  return {
    version: 1,
    selection: state.selection,
    granularity: state.granularity,
    reportingCurrency: state.reportingCurrency,
    includeProvisional: state.includeProvisional,
    detailLayout: state.detailLayout,
    topDrivers: state.selection === "topDrivers" ? ensureTopDriversSettings(modeSettingsFromState(state, true)) : previous.topDrivers,
    manualTickers: state.selection === "manualTickers" ? modeSettingsFromState(state, false) : previous.manualTickers,
  };
}

export function applySelectionModeSettings(
  state: UnrealizedPnlAnalysisRouteState,
  settings: UnrealizedPnlAnalysisSettings,
  selection: AnalysisSelection,
): UnrealizedPnlAnalysisRouteState {
  const mode = selection === "manualTickers" ? settings.manualTickers : settings.topDrivers;
  return normalizeStateTickerMode({
    ...state,
    selection,
    positionStatus: mode.positionStatus,
    tickerMode: mode.tickerMode,
    tickerIds: mode.tickerIds,
    drivers: selection === "topDrivers" ? settings.topDrivers.drivers : state.drivers,
  });
}

export function applyAnalysisSettings(
  state: UnrealizedPnlAnalysisRouteState,
  settings: UnrealizedPnlAnalysisSettings,
  explicitKeys: UnrealizedPnlAnalysisExplicitPreferenceKeys,
): UnrealizedPnlAnalysisRouteState {
  const selection = explicitKeys.selection ? state.selection : settings.selection;
  const mode = selection === "manualTickers" ? settings.manualTickers : settings.topDrivers;
  const next: UnrealizedPnlAnalysisRouteState = {
    ...state,
    selection,
    granularity: explicitKeys.granularity ? state.granularity : settings.granularity,
    reportingCurrency: explicitKeys.reportingCurrency ? state.reportingCurrency : settings.reportingCurrency,
    includeProvisional: explicitKeys.includeProvisional ? state.includeProvisional : settings.includeProvisional,
    detailLayout: settings.detailLayout,
    positionStatus: explicitKeys.positionStatus ? state.positionStatus : mode.positionStatus,
    tickerMode: explicitKeys.tickerMode ? state.tickerMode : mode.tickerMode,
    tickerIds: explicitKeys.tickerIds ? state.tickerIds : mode.tickerIds,
    drivers: explicitKeys.drivers ? state.drivers : selection === "topDrivers" ? settings.topDrivers.drivers : state.drivers,
  };
  if (next.range === "ALL" && next.granularity !== "yearly") next.range = "5Y";
  return normalizeStateTickerMode(next);
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
  if (range === "ALL" && granularity !== "yearly") range = "5Y";
  if (granularity !== "yearly" && !FIVE_YEAR_RANGES.has(range)) range = ANALYSIS_DEFAULT_STATE.range;

  const markets = normalizeCsv(read("markets")).filter(isMarketCode);
  const tickerIds = normalizeTickerIds([
    ...normalizeTickerIds(read("tickerIds") ?? read("selectedTickers") ?? read("selected")),
    ...normalizeLegacyTickerIds(read("tickers"), markets),
  ].join(","));
  const tickerMode = normalizeEnum(read("tickerMode"), ANALYSIS_TICKER_MODES, tickerIds.length > 0 ? "custom" : ANALYSIS_DEFAULT_STATE.tickerMode);
  const state: UnrealizedPnlAnalysisRouteState = {
    range,
    from: range === "CUSTOM" ? normalizeDate(read("fromDate") ?? read("from")) : null,
    to: range === "CUSTOM" ? normalizeDate(read("toDate") ?? read("to")) : null,
    granularity,
    markets,
    accounts: normalizeCsv(read("accountIds") ?? read("accounts")),
    selection: normalizeAnalysisSelection(read("selection") ?? read("selectionMode")),
    tickerMode,
    tickerIds,
    drivers: normalizeDriverCount(read("drivers") ?? read("comparisonLineCount") ?? read("lines")),
    positionStatus: normalizeAnalysisPositionStatus(read("positionStatus") ?? read("holdingsState") ?? read("holdings")),
    reportingCurrency: normalizeCurrency(read("reportingCurrency") ?? read("currency"), ANALYSIS_DEFAULT_STATE.reportingCurrency),
    includeProvisional: read("includeProvisional") === "true" || read("provisional") === "1",
    instrumentTypes: normalizeCsv(read("instrumentTypes")).filter(isInstrumentType),
    detailLayout: ANALYSIS_DEFAULT_STATE.detailLayout,
    focusDate: normalizeDate(read("focus")),
    view: normalizeEnum(read("view"), ANALYSIS_VIEW_MODES, ANALYSIS_DEFAULT_STATE.view),
  };

  return normalizeStateTickerMode(state);
}

export function unrealizedPnlRouteStateToSearchParams(
  state: UnrealizedPnlAnalysisRouteState,
): URLSearchParams {
  return unrealizedPnlStateToSearchParams(state, { includePresentationState: true });
}

export function unrealizedPnlApiStateToSearchParams(
  state: UnrealizedPnlAnalysisRouteState,
): URLSearchParams {
  return unrealizedPnlStateToSearchParams(state, { includePresentationState: false });
}

function unrealizedPnlStateToSearchParams(
  input: UnrealizedPnlAnalysisRouteState,
  options: { includePresentationState: boolean },
): URLSearchParams {
  const state = normalizeStateTickerMode(input);
  const params = new URLSearchParams();
  const shouldIncludeRange = state.range !== ANALYSIS_DEFAULT_STATE.range
    && (options.includePresentationState || state.range !== "CUSTOM");

  if (shouldIncludeRange) params.set("range", state.range);
  if (state.range === "CUSTOM") {
    if (state.from) params.set("fromDate", state.from);
    if (state.to) params.set("toDate", state.to);
  }
  if (state.granularity !== ANALYSIS_DEFAULT_STATE.granularity) params.set("granularity", state.granularity);
  if (state.markets.length > 0) params.set("markets", state.markets.join(","));
  if (state.accounts.length > 0) params.set("accountIds", state.accounts.join(","));
  if (state.selection !== ANALYSIS_DEFAULT_STATE.selection) params.set("selection", state.selection);
  if (
    state.tickerMode !== ANALYSIS_DEFAULT_STATE.tickerMode
    || state.tickerIds.length > 0
    || (state.selection === "manualTickers" && state.tickerMode === "custom")
  ) params.set("tickerMode", state.tickerMode);
  if (state.tickerMode === "custom" && state.tickerIds.length > 0) params.set("tickerIds", state.tickerIds.join(","));
  if (state.selection === "topDrivers" && state.drivers !== ANALYSIS_DEFAULT_STATE.drivers) params.set("drivers", String(state.drivers));
  if (state.positionStatus !== ANALYSIS_DEFAULT_STATE.positionStatus) params.set("positionStatus", state.positionStatus);
  params.set("reportingCurrency", state.reportingCurrency);
  if (state.includeProvisional) params.set("includeProvisional", "true");
  if (state.instrumentTypes.length > 0) params.set("instrumentTypes", state.instrumentTypes.join(","));
  if (options.includePresentationState) {
    if (state.focusDate) params.set("focus", state.focusDate);
    if (state.view !== ANALYSIS_DEFAULT_STATE.view) params.set("view", state.view);
  }

  return params;
}

export function buildUnrealizedPnlApiPath(state: UnrealizedPnlAnalysisRouteState): string {
  const params = unrealizedPnlApiStateToSearchParams(state);
  return `/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export function buildUnrealizedPnlRoutePath(
  overrides: Partial<UnrealizedPnlAnalysisRouteState> = {},
): string {
  const state = normalizeStateTickerMode({
    ...ANALYSIS_DEFAULT_STATE,
    ...overrides,
    markets: overrides.markets ?? ANALYSIS_DEFAULT_STATE.markets,
    accounts: overrides.accounts ?? ANALYSIS_DEFAULT_STATE.accounts,
    tickerIds: overrides.tickerIds ?? ANALYSIS_DEFAULT_STATE.tickerIds,
    instrumentTypes: overrides.instrumentTypes ?? ANALYSIS_DEFAULT_STATE.instrumentTypes,
  });
  if (state.range === "ALL" && state.granularity !== "yearly") state.granularity = "yearly";
  const params = unrealizedPnlRouteStateToSearchParams(state);
  return `/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export function canFetchUnrealizedPnlAnalysis(state: UnrealizedPnlAnalysisRouteState): boolean {
  return state.range !== "CUSTOM" || state.from !== null || state.to !== null;
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

export function buildSelectedSeriesId(marketCode: string, ticker: string): string {
  return `${marketCode}:${ticker.toUpperCase()}`;
}

export function updateAnalysisTickerSelection(
  current: UnrealizedPnlAnalysisRouteState,
  tickerIds: string[],
  selection: AnalysisSelection = "manualTickers",
): UnrealizedPnlAnalysisRouteState {
  return normalizeStateTickerMode({
    ...current,
    selection,
    tickerMode: "custom",
    tickerIds: normalizeTickerIds(tickerIds.join(",")),
  });
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

function repairModeSettings(
  value: unknown,
  fallback: UnrealizedPnlAnalysisModeSettings,
  includeDrivers: boolean,
): UnrealizedPnlAnalysisModeSettings & { drivers?: AnalysisDriverCount } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  return {
    positionStatus: normalizeEnum(asString(source.positionStatus), ANALYSIS_POSITION_STATUSES, fallback.positionStatus),
    tickerMode: normalizeEnum(asString(source.tickerMode), ANALYSIS_TICKER_MODES, fallback.tickerMode),
    tickerIds: normalizeTickerIds(asString(source.tickerIds) ?? (Array.isArray(source.tickerIds) ? source.tickerIds.join(",") : undefined)),
    ...(includeDrivers ? { drivers: normalizeDriverCount(asString(source.drivers) ?? (typeof source.drivers === "number" ? String(source.drivers) : undefined), fallback.drivers ?? ANALYSIS_DEFAULT_STATE.drivers) } : {}),
  };
}

function ensureTopDriversSettings(
  value: UnrealizedPnlAnalysisModeSettings & { drivers?: AnalysisDriverCount },
): UnrealizedPnlAnalysisModeSettings & { drivers: AnalysisDriverCount } {
  return {
    ...value,
    drivers: value.drivers ?? ANALYSIS_DEFAULT_STATE.drivers,
  };
}

function modeSettingsFromState(
  state: UnrealizedPnlAnalysisRouteState,
  includeDrivers: boolean,
): UnrealizedPnlAnalysisModeSettings & { drivers?: AnalysisDriverCount } {
  return {
    positionStatus: state.positionStatus,
    tickerMode: state.tickerMode,
    tickerIds: state.tickerMode === "custom" ? state.tickerIds : [],
    ...(includeDrivers ? { drivers: state.drivers } : {}),
  };
}

function normalizeStateTickerMode(state: UnrealizedPnlAnalysisRouteState): UnrealizedPnlAnalysisRouteState {
  if (state.tickerMode === "allEligible") return { ...state, tickerIds: [] };
  if (state.tickerIds.length > 0) return state;
  if (state.selection === "manualTickers") return { ...state, tickerIds: [] };
  return { ...state, tickerMode: "allEligible", tickerIds: [] };
}

function normalizeEnum<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = value?.trim();
  if (normalized && (allowed as readonly string[]).includes(normalized)) return normalized as T[number];
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

function normalizeTickerIds(value: string | undefined): string[] {
  return normalizeCsv(value).flatMap((item) => {
    const [marketCode, ticker] = item.split(":");
    if (!marketCode || !ticker || !isMarketCode(marketCode)) return [];
    return [`${marketCode}:${ticker.toUpperCase()}`];
  });
}

function normalizeLegacyTickerIds(value: string | undefined, markets: AnalysisMarketCode[]): string[] {
  const tickers = normalizeCsv(value).filter((ticker) => !ticker.includes(":"));
  if (tickers.length === 0) return [];
  const scopedMarkets = markets.length > 0 ? markets : [...ANALYSIS_MARKET_CODES];
  return normalizeTickerIds(scopedMarkets.flatMap((marketCode) => tickers.map((ticker) => `${marketCode}:${ticker}`)).join(","));
}

function normalizeDriverCount(value: string | undefined, fallback: AnalysisDriverCount = ANALYSIS_DEFAULT_STATE.drivers): AnalysisDriverCount {
  const parsed = Number.parseInt(value ?? "", 10);
  return (ANALYSIS_DRIVER_COUNTS as readonly number[]).includes(parsed) ? parsed as AnalysisDriverCount : fallback;
}

function normalizeLegacyDriverCount(value: number, fallback: AnalysisDriverCount): AnalysisDriverCount {
  if (!Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(value);
  if (parsed < 1 || parsed > 20) return fallback;
  return ANALYSIS_DRIVER_COUNTS.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(parsed - nearest);
    const candidateDistance = Math.abs(parsed - candidate);
    return candidateDistance < nearestDistance || (candidateDistance === nearestDistance && candidate > nearest)
      ? candidate
      : nearest;
  }, ANALYSIS_DRIVER_COUNTS[0]);
}

function normalizeAnalysisSelection(value: string | undefined): AnalysisSelection {
  if (value === "manual") return "manualTickers";
  if (value === "auto" || value === "top-drivers") return "topDrivers";
  return normalizeEnum(value, ANALYSIS_SELECTIONS, ANALYSIS_DEFAULT_STATE.selection);
}

function normalizeAnalysisPositionStatus(value: string | undefined): AnalysisPositionStatus {
  if (value === "include_sold_out" || value === "include-sold" || value === "include-sold-out") return "includeClosed";
  if (value === "open_only" || value === "current-only") return "openOnly";
  return normalizeEnum(value, ANALYSIS_POSITION_STATUSES, ANALYSIS_DEFAULT_STATE.positionStatus);
}

function normalizeCurrency(value: string | undefined, fallback: AccountDefaultCurrency): AccountDefaultCurrency {
  return typeof value === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(value)
    ? value as AccountDefaultCurrency
    : fallback;
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
