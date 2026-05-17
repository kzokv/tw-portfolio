import { Suspense } from "react";
import type { AccountDto, LocaleCode } from "@vakwen/shared-types";
import { DividendCalendarClient } from "../../components/dividends/DividendCalendarClient";
import { DividendReviewClient } from "../../components/dividends/DividendReviewClient";
import { DividendsTabsClient } from "../../components/dividends/DividendsTabsClient";
import { resolveInitialDividendsTab } from "../../components/dividends/dividendsTabsUtils";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { fetchDashboardSnapshot } from "../../features/dashboard/services/dashboardService";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
  type DividendReviewQuery,
} from "../../features/dividends/services/dividendService";
import { resolvePresetDates, type DatePreset } from "../../components/dividends/dividendReviewUtils";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { getDictionary } from "../../lib/i18n";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface DividendsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

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

function get(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

function searchParamsToReviewQuery(sp: Record<string, string | string[] | undefined>): DividendReviewQuery {
  const preset = (get(sp, "preset") ?? "currentYear") as DatePreset;
  const today = new Date();
  const resolved = resolvePresetDates(preset, today);

  const fromDate = get(sp, "fromPaymentDate") ?? resolved.from ?? "";
  const toDate = get(sp, "toPaymentDate") ?? resolved.to ?? "";
  const status = get(sp, "status") ?? "all";
  const sortBy = get(sp, "sortBy") ?? "paymentDate";
  const sortOrder = (get(sp, "sortOrder") ?? "desc") as "asc" | "desc";
  const page = parseInt(get(sp, "page") ?? "1", 10) || 1;
  const ticker = get(sp, "ticker");
  const accountId = get(sp, "accountId");

  let postingStatus: string | undefined;
  let reconciliationStatus: string | undefined;
  if (status === "needsReconciliation") {
    postingStatus = "posted";
    reconciliationStatus = "open";
  } else if (status !== "all") {
    reconciliationStatus = status;
  }

  return {
    fromPaymentDate: fromDate || undefined,
    toPaymentDate: toDate || undefined,
    ticker: ticker || undefined,
    accountId: accountId || undefined,
    ...(postingStatus ? { postingStatus } : {}),
    ...(reconciliationStatus ? { reconciliationStatus } : {}),
    sortBy,
    sortOrder,
    page,
    limit: 25,
  };
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

  // Fetch BOTH tabs' data in parallel — keeps tab-switch instant
  // (no second SSR round-trip). Heavy enough that we may revisit if it
  // becomes a perf concern.
  const [dict, calendarSnapshot, reviewData, years] = await Promise.all([
    Promise.resolve(getDictionary(locale)),
    fetchDividendCalendarSnapshot(currentMonthQuery()).catch(() => ({
      events: [],
      ledgerEntries: [],
    })),
    fetchDividendLedgerReview(searchParamsToReviewQuery(sp)).catch(() => ({
      ledgerEntries: [],
      total: 0,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 0,
        byMonth: {},
        byTicker: {},
      },
    })),
    fetchDividendLedgerYears().catch(() => []),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dividends" isDemo={session.isDemo} initialProfile={profile} initialSidebarOpen={sidebarOpen}>
        {/* Tab labels intentionally hard-coded English for v1 — keys not
            yet in the i18n type. Polish (en + zh-TW) tracked as a follow-up. */}
        <DividendsTabsClient
          initialTab={initialTab}
          calendarLabel="Calendar"
          ledgerLabel="Review"
          calendarSlot={
            <DividendCalendarClient initialSnapshot={calendarSnapshot} dict={dict} locale={locale} />
          }
          ledgerSlot={
            <DividendReviewClient
              initialData={reviewData}
              dict={dict}
              locale={locale}
              accounts={accounts}
              years={years}
            />
          }
        />
      </AppShell>
    </Suspense>
  );
}
