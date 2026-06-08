import type {
  DailyReviewReportDto,
  MarketReportDto,
  PortfolioReportDto,
} from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import { reportApiPath, type ReportRouteState, type ReportTab } from "../reportState";

export type ReportDtoByTab = {
  "daily-review": DailyReviewReportDto;
  portfolio: PortfolioReportDto;
  market: MarketReportDto;
};

export type AnyReportDto = ReportDtoByTab[ReportTab];

interface FetchReportOptions {
  signal?: AbortSignal;
}

export async function fetchReport<TTab extends ReportTab>(
  tab: TTab,
  state: ReportRouteState,
  options: FetchReportOptions = {},
): Promise<ReportDtoByTab[TTab]> {
  const path = reportApiPath(tab, state);
  return options.signal
    ? getJson<ReportDtoByTab[TTab]>(path, { signal: options.signal })
    : getJson<ReportDtoByTab[TTab]>(path);
}
