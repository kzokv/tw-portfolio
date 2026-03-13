import { getJson } from "../../../lib/api";
import type { DashboardOverviewDto, DashboardPerformanceDto, DashboardPerformanceRange } from "@tw-portfolio/shared-types";
import type { DashboardSnapshot } from "../types";

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  return getJson<DashboardOverviewDto>("/dashboard/overview");
}

export async function fetchDashboardPerformance(range: DashboardPerformanceRange): Promise<DashboardPerformanceDto> {
  return getJson<DashboardPerformanceDto>(`/dashboard/performance?range=${encodeURIComponent(range)}`);
}
