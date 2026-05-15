import { Suspense } from "react";
import type { AccountDto, LocaleCode } from "@vakwen/shared-types";
import { DividendReviewClient } from "../../../components/dividends/DividendReviewClient";
import { DashboardLoading } from "../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../components/layout/AppShell";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import {
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
  type DividendReviewQuery,
} from "../../../features/dividends/services/dividendService";
import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { getDictionary } from "../../../lib/i18n";
import { resolvePresetDates, type DatePreset } from "../../../components/dividends/dividendReviewUtils";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";

interface DividendReviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function get(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

function searchParamsToQuery(sp: Record<string, string | string[] | undefined>): DividendReviewQuery {
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

export default async function DividendReviewPage({ searchParams }: DividendReviewPageProps) {
  const [sp, session, profile] = await Promise.all([
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
  ]);

  let locale: LocaleCode = "en";
  let accounts: AccountDto[] = [];
  try {
    const dashboard = await fetchDashboardSnapshot();
    locale = dashboard.settings?.locale ?? "en";
    accounts = dashboard.accounts ?? [];
  } catch {
    // Fall back to English
  }

  const [dict, initialData, years] = await Promise.all([
    Promise.resolve(getDictionary(locale)),
    fetchDividendLedgerReview(searchParamsToQuery(sp)).catch(() => ({
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

  // accounts already populated in the try block above

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell section="dividends" isDemo={session.isDemo} initialProfile={profile}>
        <DividendReviewClient
          initialData={initialData}
          dict={dict}
          locale={locale}
          accounts={accounts}
          years={years}
        />
      </AppShell>
    </Suspense>
  );
}
