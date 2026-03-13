import { Suspense } from "react";
import { DashboardLoading } from "../components/dashboard/DashboardLoading";
import { AppShell } from "../components/layout/AppShell";

export default function HomePage() {
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dashboard" />
    </Suspense>
  );
}
