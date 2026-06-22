import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { ReportsClient } from "../../components/reports/ReportsClient";
import { parseReportRouteState } from "../../features/reports/reportState";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const rawSearchParams = await searchParams;
  const initialState = parseReportRouteState(rawSearchParams);
  const [session, profile, sidebarOpen, settings] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell
        section="reports"
        isDemo={session.isDemo}
        localeOverride={settings?.locale ?? "en"}
        initialProfile={profile}
        initialSettings={settings}
        initialSidebarOpen={sidebarOpen}
        portfolioConfigMode="lazy"
      >
        <ReportsClient initialReport={null} initialState={initialState} />
      </AppShell>
    </Suspense>
  );
}
