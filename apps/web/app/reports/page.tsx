import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { ReportsClient } from "../../components/reports/ReportsClient";
import { fetchReport, type AnyReportDto } from "../../features/reports/services/reportService";
import { parseReportRouteState } from "../../features/reports/reportState";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import type { ReportRouteState } from "../../features/reports/reportState";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const REPORT_SERVER_SEED_TIMEOUT_MS = 1_500;

async function fetchInitialReportWithinPaintBudget(state: ReportRouteState): Promise<AnyReportDto | null> {
  const reportPromise = fetchReport(state.tab, state).catch(() => null);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), REPORT_SERVER_SEED_TIMEOUT_MS);
  });

  try {
    return await Promise.race([reportPromise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const rawSearchParams = await searchParams;
  const initialState = parseReportRouteState(rawSearchParams);
  const [session, profile, sidebarOpen, settings, initialReport] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
    fetchInitialReportWithinPaintBudget(initialState),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell
        section="reports"
        isDemo={session.isDemo}
        localeOverride={settings?.locale ?? "en"}
        initialProfile={profile}
        initialSidebarOpen={sidebarOpen}
        portfolioConfigMode="lazy"
      >
        <ReportsClient initialReport={initialReport} initialState={initialState} />
      </AppShell>
    </Suspense>
  );
}
