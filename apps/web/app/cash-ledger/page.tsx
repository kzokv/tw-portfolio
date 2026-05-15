import { Suspense } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import { CashLedgerClient } from "../../features/cash-ledger/components/CashLedgerClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { fetchDashboardSnapshot } from "../../features/dashboard/services/dashboardService";
import { fetchCashLedgerEntries } from "../../features/cash-ledger/services/cashLedgerService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { getDictionary } from "../../lib/i18n";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function CashLedgerPage() {
  const [session, profile] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
  ]);

  let locale: LocaleCode = "en";
  try {
    const dashboard = await fetchDashboardSnapshot();
    locale = dashboard.settings?.locale ?? "en";
  } catch {
    // Fall back to English and let the client shell fetch fresh dashboard state.
  }

  const [dict, initialData] = await Promise.all([
    Promise.resolve(getDictionary(locale)),
    fetchCashLedgerEntries().catch(() => ({
      entries: [],
      summary: [],
      total: 0,
    })),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="cash-ledger" isDemo={session.isDemo} initialProfile={profile}>
        <CashLedgerClient initialData={initialData} dict={dict} locale={locale} />
      </AppShell>
    </Suspense>
  );
}
