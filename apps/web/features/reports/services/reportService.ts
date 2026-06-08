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

export async function fetchReport<TTab extends ReportTab>(
  tab: TTab,
  state: ReportRouteState,
): Promise<ReportDtoByTab[TTab]> {
  return getJson<ReportDtoByTab[TTab]>(reportApiPath(tab, state));
}
