import { Suspense } from "react";
import type { AccountDto, LocaleCode } from "@vakwen/shared-types";
import { DividendsTabsClient } from "../../components/dividends/DividendsTabsClient";
import {
  currentMonthQuery,
  searchParamsToReviewQuery,
} from "../../components/dividends/dividendsPageQuery";
import { resolveInitialDividendsTab } from "../../components/dividends/dividendsTabsUtils";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { fetchDashboardSnapshot } from "../../features/dashboard/services/dashboardService";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../features/dividends/services/dividendService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { getDictionary } from "../../lib/i18n";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface DividendsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DividendsPage({ searchParams }: DividendsPageProps) {
  const [sp, session, profile, sidebarOpen] = await Promise.all([
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);

  let locale: LocaleCode = "en";
  let accounts: AccountDto[] = [];
  try {
    const dashboard = await fetchDashboardSnapshot();
    locale = dashboard.settings?.locale ?? "en";
    accounts = dashboard.accounts ?? [];
  } catch {
    // Fall back to English; client shell will re-fetch.
  }

  const initialTab = resolveInitialDividendsTab(sp);
  const dict = getDictionary(locale);

  const calendarSnapshot = initialTab === "calendar"
    ? await fetchDividendCalendarSnapshot(currentMonthQuery()).catch(() => ({
      events: [],
      ledgerEntries: [],
    }))
    : null;

  const reviewData = initialTab === "ledger"
    ? await fetchDividendLedgerReview(searchParamsToReviewQuery(sp)).catch(() => ({
      ledgerEntries: [],
      total: 0,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 0,
        byMonth: {},
        byTicker: {},
      },
    }))
    : null;

  const years = initialTab === "ledger"
    ? await fetchDividendLedgerYears().catch(() => [])
    : [];

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dividends" isDemo={session.isDemo} initialProfile={profile} initialSidebarOpen={sidebarOpen}>
        <DividendsTabsClient
          initialTab={initialTab}
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale={locale}
          accounts={accounts}
          initialCalendarSnapshot={calendarSnapshot}
          initialReviewData={reviewData}
          initialYears={years}
        />
      </AppShell>
    </Suspense>
  );
}
