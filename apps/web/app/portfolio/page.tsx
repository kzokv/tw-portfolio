import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";

export default function PortfolioPage() {
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="portfolio" />
    </Suspense>
  );
}
