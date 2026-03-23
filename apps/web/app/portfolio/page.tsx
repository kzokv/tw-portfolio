import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { requireSession } from "../../lib/auth";

export default async function PortfolioPage() {
  const session = await requireSession();
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="portfolio" isDemo={session.isDemo} />
    </Suspense>
  );
}
