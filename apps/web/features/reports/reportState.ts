import {
  ACCOUNT_DEFAULT_CURRENCIES,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  REPORT_CURRENCY_MODES,
  REPORT_SCOPES,
  dashboardPerformanceRangesSchema,
  type AccountDefaultCurrency,
  type DashboardPerformanceRange,
  type ReportCurrencyMode,
  type ReportScope,
} from "@vakwen/shared-types";

export const REPORT_TABS = ["daily-review", "portfolio", "market"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export interface ReportRouteState {
  tab: ReportTab;
  scope: ReportScope;
  currencyMode: ReportCurrencyMode;
  currency: AccountDefaultCurrency;
  range: DashboardPerformanceRange;
}

export const DEFAULT_REPORT_STATE: ReportRouteState = {
  tab: "daily-review",
  scope: "all",
  currencyMode: "auto",
  currency: "TWD",
  range: DEFAULT_DASHBOARD_PERFORMANCE_RANGES.includes("1Y") ? "1Y" : DEFAULT_DASHBOARD_PERFORMANCE_RANGES[0] ?? "1Y",
};

export function parseReportRouteState(input: URLSearchParams | Record<string, string | string[] | undefined>): ReportRouteState {
  const read = (key: string): string | undefined => {
    if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
    const value = input[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const tab = normalizeValue(read("tab"), REPORT_TABS, DEFAULT_REPORT_STATE.tab);
  const scope = normalizeValue(read("scope"), REPORT_SCOPES, DEFAULT_REPORT_STATE.scope);
  const currencyMode = normalizeValue(read("currencyMode"), REPORT_CURRENCY_MODES, DEFAULT_REPORT_STATE.currencyMode);
  const currency = normalizeValue(read("currency"), ACCOUNT_DEFAULT_CURRENCIES, DEFAULT_REPORT_STATE.currency);
  const range = normalizeRange(read("range"));

  return {
    tab,
    scope,
    currencyMode,
    currency,
    range,
  };
}

export function reportRouteStateToSearchParams(state: ReportRouteState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", state.tab);
  params.set("scope", state.scope);
  params.set("currencyMode", state.currencyMode);
  if (state.currencyMode === "specified") params.set("currency", state.currency);
  params.set("range", state.range);
  return params;
}

export function reportApiPath(tab: ReportTab, state: ReportRouteState): string {
  const params = new URLSearchParams();
  params.set("scope", state.scope);
  params.set("currencyMode", state.currencyMode);
  if (state.currencyMode === "specified") params.set("currency", state.currency);
  if (tab !== "daily-review") params.set("range", state.range);
  params.set("limit", "25");

  const endpoint = tab === "daily-review"
    ? "daily-review"
    : tab === "portfolio"
      ? "portfolio"
      : "market";

  return `/reports/${endpoint}?${params.toString()}`;
}

function normalizeValue<const T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  const normalized = value?.trim();
  if (normalized && (allowed as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }
  return fallback;
}

function normalizeRange(value: string | undefined): DashboardPerformanceRange {
  const normalized = value?.trim();
  if (normalized && dashboardPerformanceRangesSchema.safeParse([normalized]).success) {
    return normalized;
  }
  return DEFAULT_REPORT_STATE.range;
}
