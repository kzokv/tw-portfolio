import { Suspense } from "react";
import type { AccountDto, LocaleCode, ShellPortfolioConfigDto, UserSettings } from "@vakwen/shared-types";
import { DividendsTabsClient } from "../../components/dividends/DividendsTabsClient";
import {
  DIVIDENDS_LEDGER_ONLY_PARAMS,
  resolveInitialDividendsTab,
} from "../../components/dividends/dividendsTabsUtils";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
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
  const [sp, session, profile, sidebarOpen, settings] = await Promise.all([
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
  ]);

  const locale: LocaleCode = settings?.locale ?? "en";
  const resolvedInitialTab = resolveInitialDividendsTab(sp);
  const dict = getDictionary(locale);
  const initialTab = hasExplicitDividendsView(sp) ? resolvedInitialTab : "calendar";
  const accounts: AccountDto[] = initialTab === "ledger"
    ? await getJson<ShellPortfolioConfigDto>("/settings/fee-config")
      .then((config) => config.accounts)
      .catch(() => [])
    : [];

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
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
          accounts={accounts}
          initialCalendarSnapshot={null}
          initialReviewData={null}
          initialYears={[]}
        />
      </AppShell>
    </Suspense>
  );
}
