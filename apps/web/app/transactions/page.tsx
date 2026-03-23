import { Suspense } from "react";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { requireSession } from "../../lib/auth";

export default async function TransactionsPage() {
  const session = await requireSession();
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="transactions" isDemo={session.isDemo} />
    </Suspense>
  );
}
