import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { PortfolioClient } from "../../components/portfolio/PortfolioClient";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function PortfolioPage() {
  const [session, profile, sidebarOpen] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="portfolio" isDemo={session.isDemo} initialProfile={profile} initialSidebarOpen={sidebarOpen}>
        <PortfolioClient />
      </AppShell>
    </Suspense>
  );
}
