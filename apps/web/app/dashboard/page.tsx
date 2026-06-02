import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardClient } from "../../components/dashboard/DashboardClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { fetchDashboardPrimaryData } from "../../features/dashboard/services/dashboardService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function DashboardPage() {
  const [session, profile, sidebarOpen, settings, initialPrimaryData] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
    fetchDashboardPrimaryData().catch(() => null),
  ]);
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell
        section="dashboard"
        isDemo={session.isDemo}
        localeOverride={settings?.locale ?? "en"}
        initialProfile={profile}
        initialSidebarOpen={sidebarOpen}
      >
        <DashboardClient initialPrimaryData={initialPrimaryData} />
      </AppShell>
    </Suspense>
  );
}
