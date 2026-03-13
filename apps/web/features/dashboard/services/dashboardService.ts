import { getJson } from "../../../lib/api";
import type { DashboardOverviewDto } from "@tw-portfolio/shared-types";
import type { DashboardSnapshot } from "../types";

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  return getJson<DashboardOverviewDto>("/dashboard/overview");
}
