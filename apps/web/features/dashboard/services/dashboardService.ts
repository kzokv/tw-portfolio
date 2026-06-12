import { getJson } from "../../../lib/api";
import type { DashboardOverviewDto, DashboardPerformanceDto, DashboardPerformanceRange } from "@vakwen/shared-types";
import type { DashboardSnapshot } from "../types";

interface DashboardRequestOptions {
  signal?: AbortSignal;
}

export async function fetchDashboardPrimaryData(): Promise<DashboardSnapshot> {
  return getJson<DashboardOverviewDto>("/dashboard/primary");
}

export async function fetchDashboardEnrichmentData(): Promise<DashboardSnapshot> {
  return getJson<DashboardOverviewDto>("/dashboard/enrichment");
}

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  return fetchDashboardEnrichmentData();
}

export async function fetchDashboardPerformanceEnrichment(
  range: DashboardPerformanceRange,
  options: DashboardRequestOptions = {},
): Promise<DashboardPerformanceDto> {
  return getJson<DashboardPerformanceDto>(`/dashboard/performance?range=${encodeURIComponent(range)}`, options);
}

export async function fetchDashboardPerformance(range: DashboardPerformanceRange): Promise<DashboardPerformanceDto> {
  return fetchDashboardPerformanceEnrichment(range);
}
