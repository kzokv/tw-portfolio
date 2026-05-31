import { Suspense } from "react";
import type { AccountDto, LocaleCode } from "@vakwen/shared-types";
import { DividendsTabsClient } from "../../components/dividends/DividendsTabsClient";
import {
  currentMonthQuery,
  searchParamsToReviewQuery,
} from "../../components/dividends/dividendsPageQuery";
import {
  DIVIDENDS_LEDGER_ONLY_PARAMS,
  resolveInitialDividendsTab,
} from "../../components/dividends/dividendsTabsUtils";
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

function hasExplicitDividendsView(searchParams: Record<string, string | string[] | undefined>): boolean {
  const view = typeof searchParams.view === "string"
    ? searchParams.view
    : Array.isArray(searchParams.view)
      ? searchParams.view[0]
      : undefined;

  if (view === "calendar" || view === "ledger") {
    return true;
  }

  return DIVIDENDS_LEDGER_ONLY_PARAMS.some((key) => {
    const value = searchParams[key];
    return typeof value === "string" || (Array.isArray(value) && value.length > 0);
  });
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

  const resolvedInitialTab = resolveInitialDividendsTab(sp);
  const shouldProbeReviewFirst = !hasExplicitDividendsView(sp);
  const dict = getDictionary(locale);
  const reviewFallback = {
    ledgerEntries: [],
    total: 0,
    aggregates: {
      totalExpectedCashAmount: {},
      totalReceivedCashAmount: {},
      openCount: 0,
      byMonth: {},
      byTicker: {},
    },
  };

  let initialTab = resolvedInitialTab;
  let calendarSnapshot = null;
  let reviewData = null;
  let years: number[] = [];

  if (resolvedInitialTab === "ledger") {
    [reviewData, years] = await Promise.all([
      fetchDividendLedgerReview(searchParamsToReviewQuery(sp)).catch(() => reviewFallback),
      fetchDividendLedgerYears().catch(() => []),
    ]);
  } else if (shouldProbeReviewFirst) {
    const reviewPreview = await fetchDividendLedgerReview(searchParamsToReviewQuery(sp)).catch(() => null);
    if ((reviewPreview?.aggregates.openCount ?? 0) > 0) {
      initialTab = "ledger";
      reviewData = reviewPreview;
      years = await fetchDividendLedgerYears().catch(() => []);
    } else {
      calendarSnapshot = await fetchDividendCalendarSnapshot(currentMonthQuery()).catch(() => ({
        events: [],
        ledgerEntries: [],
      }));
    }
  } else {
    calendarSnapshot = await fetchDividendCalendarSnapshot(currentMonthQuery()).catch(() => ({
      events: [],
      ledgerEntries: [],
    }));
  }

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
