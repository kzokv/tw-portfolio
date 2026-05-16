import { Suspense } from "react";
import { DashboardClient } from "../../components/dashboard/DashboardClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function DashboardPage() {
  const [session, profile, sidebarOpen] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dashboard" isDemo={session.isDemo} initialProfile={profile} initialSidebarOpen={sidebarOpen}>
        <DashboardClient />
      </AppShell>
    </Suspense>
  );
}
