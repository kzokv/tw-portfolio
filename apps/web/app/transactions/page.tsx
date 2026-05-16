import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { TransactionsClient } from "../../components/transactions/TransactionsClient";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function TransactionsPage() {
  const [session, profile] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
  ]);
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="transactions" isDemo={session.isDemo} initialProfile={profile}>
        <TransactionsClient />
      </AppShell>
    </Suspense>
  );
}
