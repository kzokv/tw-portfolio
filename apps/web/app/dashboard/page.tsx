import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function DashboardPage() {
  const [session, profile] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
  ]);
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dashboard" isDemo={session.isDemo} initialProfile={profile} />
    </Suspense>
  );
}
