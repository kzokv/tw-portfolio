import {
  REPORT_SCOPES,
  type DashboardPerformanceGapReason,
  type MarketCode,
  type ReportDiagnosticsDto,
} from "@vakwen/shared-types";
import {
  parseReportRouteState,
  reportRouteStateToSearchParams,
  type ReportRouteState,
} from "./reportState";

export const REPORT_HEALTH_QUERY_FLAG = "health";

export const REPORT_HEALTH_REASONS = [
  "missing_quote",
  "provisional_quote",
  "non_current_price",
  "missing_fx",
  "missing_snapshot",
  "stale_snapshot",
  "missing_provider_source",
] as const;

export type ReportHealthReason = typeof REPORT_HEALTH_REASONS[number];

const REPORT_HEALTH_REASON_SET = new Set<string>(REPORT_HEALTH_REASONS);

export interface ReportHealthQuery {
  open: boolean;
  reasons: ReportHealthReason[];
}

export function parseReportHealthQuery(params: URLSearchParams): ReportHealthQuery {
  const open = params.get(REPORT_HEALTH_QUERY_FLAG) === "1";
  const reasons = [
    ...params.getAll("healthReason"),
    ...params.getAll("healthReasons").flatMap((value) => value.split(",")),
  ]
    .map((value) => value.trim())
    .filter((value): value is ReportHealthReason => REPORT_HEALTH_REASON_SET.has(value));
  return {
    open,
    reasons: [...new Set(reasons)],
  };
}

export function buildReportsHealthHref({
  reasons = [],
  state,
}: {
  reasons?: ReportHealthReason[];
  state: ReportRouteState;
}): string {
  const params = reportRouteStateToSearchParams(state);
  appendReportHealthQuery(params, reasons);
  return `/reports?${params.toString()}`;
}

export function buildDashboardReportsHealthHref(reasons: ReportHealthReason[] = []): string {
  const params = new URLSearchParams();
  params.set("tab", "portfolio");
  params.set("scope", "all");
  appendReportHealthQuery(params, reasons);
  return `/reports?${params.toString()}`;
}

export function buildReportsHealthHrefFromCurrentParams(
  currentParams: URLSearchParams,
  reasons: ReportHealthReason[] = [],
): string {
  const state = parseReportRouteState(currentParams);
  return buildReportsHealthHref({ state, reasons });
}

export function reportHealthReasonFromPerformanceGap(
  reason: DashboardPerformanceGapReason,
): ReportHealthReason {
  if (reason === "missing_fx") return "missing_fx";
  if (reason === "stale_snapshot") return "stale_snapshot";
  return "missing_snapshot";
}

export function reportHealthReasonFromDiagnostics(
  reason: ReportDiagnosticsDto["knownGapReasons"][number],
): ReportHealthReason {
  return REPORT_HEALTH_REASON_SET.has(reason) ? reason : "missing_snapshot";
}

export function buildTickerRepairHref({
  marketCode,
  reason,
  returnTo,
  tickers,
}: {
  marketCode?: MarketCode | string | null;
  reason?: ReportHealthReason | string | null;
  returnTo?: string | null;
  tickers?: string[];
}): string {
  const params = new URLSearchParams();
  params.set("repair", "1");
  params.set("origin", "data-health");
  if (reason) params.set("healthReason", reason);
  if (marketCode && REPORT_SCOPES.includes(marketCode as MarketCode)) params.set("market", marketCode);
  const uniqueTickers = [...new Set((tickers ?? []).map((ticker) => ticker.trim()).filter(Boolean))];
  if (uniqueTickers.length > 0) params.set("tickers", uniqueTickers.join(","));
  if (returnTo) params.set("returnTo", returnTo);
  return `/settings/tickers?${params.toString()}`;
}

function appendReportHealthQuery(params: URLSearchParams, reasons: ReportHealthReason[]): void {
  params.set(REPORT_HEALTH_QUERY_FLAG, "1");
  params.delete("healthReason");
  params.delete("healthReasons");
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length === 1) {
    params.set("healthReason", uniqueReasons[0]);
  } else if (uniqueReasons.length > 1) {
    params.set("healthReasons", uniqueReasons.join(","));
  }
}
