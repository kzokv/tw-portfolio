import { Suspense } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { DividendCalendarClient } from "../../components/dividends/DividendCalendarClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { fetchDashboardSnapshot } from "../../features/dashboard/services/dashboardService";
import { fetchDividendCalendarSnapshot } from "../../features/dividends/services/dividendService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { getDictionary } from "../../lib/i18n";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

function currentMonthQuery(): { fromPaymentDate: string; toPaymentDate: string; limit: number } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  return {
    fromPaymentDate: start.toISOString().slice(0, 10),
    toPaymentDate: end.toISOString().slice(0, 10),
    limit: 500,
  };
}

export default async function DividendsPage() {
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

  const [dict, initialSnapshot] = await Promise.all([
    Promise.resolve(getDictionary(locale)),
    fetchDividendCalendarSnapshot(currentMonthQuery()).catch(() => ({
      events: [],
      ledgerEntries: [],
    })),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dividends" isDemo={session.isDemo} initialProfile={profile}>
        <DividendCalendarClient initialSnapshot={initialSnapshot} dict={dict} locale={locale} />
      </AppShell>
    </Suspense>
  );
}
