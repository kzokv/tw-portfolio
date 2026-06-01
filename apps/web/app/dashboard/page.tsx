import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardClient } from "../../components/dashboard/DashboardClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function DashboardPage() {
  const [session, profile, sidebarOpen, settings] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
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
        <DashboardClient />
      </AppShell>
    </Suspense>
  );
}
