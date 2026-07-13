import { Suspense } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { DividendsTabsClient } from "../../components/dividends/DividendsTabsClient";
import {
  DIVIDENDS_LEDGER_ONLY_PARAMS,
  resolveInitialDividendsTab,
} from "../../components/dividends/dividendsTabsUtils";
import {
  calendarMonthFromSearchParams,
  calendarQueryFromSearchParams,
  searchParamsToReviewQuery,
} from "../../components/dividends/dividendsPageQuery";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { getDictionary } from "../../lib/i18n";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendReviewPrimary,
} from "../../features/dividends/services/dividendService";
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
  const [sp, session, profile, sidebarOpen, settings] = await Promise.all([
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
  ]);

  const locale: LocaleCode = settings?.locale ?? "en";
  const resolvedInitialTab = resolveInitialDividendsTab(sp);
  const dict = getDictionary(locale);
  const loadingCopy = getRouteLoadingLabels(locale).dividends;
  const initialTab = hasExplicitDividendsView(sp) ? resolvedInitialTab : "calendar";
  const initialCalendarMonth = calendarMonthFromSearchParams(sp);
  const initialReviewQuery = searchParamsToReviewQuery(sp);
  const [initialCalendarSnapshot, initialReviewData] = await Promise.all([
    initialTab === "calendar"
      ? fetchDividendCalendarSnapshot(calendarQueryFromSearchParams(sp)).catch(() => null)
      : Promise.resolve(null),
    initialTab === "ledger"
      ? fetchDividendReviewPrimary(initialReviewQuery).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="dividends"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        portfolioConfigMode="lazy"
        initialSidebarOpen={sidebarOpen}
      >
        <DividendsTabsClient
          initialTab={initialTab}
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale={locale}
          accounts={initialReviewData?.accounts ?? []}
          initialCalendarMonth={initialCalendarMonth}
          initialCalendarSnapshot={initialCalendarSnapshot}
          initialReviewData={initialReviewData}
          initialReviewQuery={initialReviewQuery}
          initialYears={initialReviewData?.years ?? []}
        />
      </AppShell>
    </Suspense>
  );
}
