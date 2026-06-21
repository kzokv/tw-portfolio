import {
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  REPORT_SCOPES,
  dashboardPerformanceRangesSchema,
  type DashboardPerformanceRange,
  type ReportScope,
} from "@vakwen/shared-types";

export const REPORT_TABS = ["daily-review", "portfolio", "market"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const REPORT_HOLDINGS_FILTER_LIMIT = 1000;

export interface ReportRouteState {
  tab: ReportTab;
  scope: ReportScope;
  range: DashboardPerformanceRange;
  useServerDefaultRange?: boolean;
}

export const DEFAULT_REPORT_STATE: ReportRouteState = {
  tab: "daily-review",
  scope: "all",
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
  const range = normalizeRange(read("range"));

  return {
    tab,
    scope,
    range,
  };
}

export function reportRouteStateToSearchParams(state: ReportRouteState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", state.tab);
  params.set("scope", state.scope);
  if (!state.useServerDefaultRange) {
    params.set("range", state.range);
  }
  return params;
}

export function reportApiPath(tab: ReportTab, state: ReportRouteState): string {
  const params = new URLSearchParams();
  params.set("scope", state.scope);
  params.set("currencyMode", "auto");
  if (tab !== "daily-review" || !state.useServerDefaultRange) {
    params.set("range", state.range);
  }
  params.set("limit", String(REPORT_HOLDINGS_FILTER_LIMIT));

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
