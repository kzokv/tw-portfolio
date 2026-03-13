import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";

export default function TransactionsPage() {
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="transactions" />
    </Suspense>
  );
}
