import { Suspense } from "react";
import Link from "next/link";
import { getDictionary } from "../../../lib/i18n";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { DashboardLoading } from "../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../components/layout/AppShell";
import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { TickerHistoryClient } from "./TickerHistoryClient";
import { fetchRepairInstrument } from "../../../features/settings/services/repairService";
import { MARKET_CODES, type InstrumentCatalogItemDto, type MarketCode } from "@vakwen/shared-types";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";
import { fetchTickerDetails } from "../../../features/portfolio/services/tickerDetailsService";
import { findHoldingGroup, resolveHoldingGroups } from "../../../features/portfolio/holdingGroups";

interface TickerHistoryPageProps {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ accountId?: string; marketCode?: string }>;
}

function normalizeMarketCode(value?: string): MarketCode | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return (MARKET_CODES as readonly string[]).includes(normalized) ? (normalized as MarketCode) : undefined;
}

export default async function TickerHistoryPage({ params, searchParams }: TickerHistoryPageProps) {
  const [{ ticker: rawTicker }, { accountId, marketCode }, session, profile, sidebarOpen] = await Promise.all([
    params,
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);
  const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();
  const scopedAccountId = accountId?.trim() ? accountId.trim() : undefined;
  const scopedMarketCode = normalizeMarketCode(marketCode);

  let dashboard: Awaited<ReturnType<typeof fetchDashboardSnapshot>> | null = null;
  let transactions: Awaited<ReturnType<typeof fetchTransactionHistory>> = [];
  let instrument: InstrumentCatalogItemDto | null = null;

  try {
    [dashboard, transactions, instrument] = await Promise.all([
      fetchDashboardSnapshot(),
      fetchTransactionHistory({ ticker, accountId: scopedAccountId, marketCode: scopedMarketCode }),
      fetchRepairInstrument(ticker),
    ]);
  } catch {
    // render error fallback below
  }

  if (!dashboard) {
    return (
      <Suspense fallback={<DashboardLoading standalone />}>
        <AppShell isDemo={session.isDemo} initialProfile={profile} initialSidebarOpen={sidebarOpen}>
          <p>
            Failed to load data for {ticker}.{" "}
            <Link href="/portfolio">Back to portfolio</Link>
          </p>
        </AppShell>
      </Suspense>
    );
  }

  const locale = dashboard.settings?.locale ?? "en";
  const dict = getDictionary(locale);
  const holdingGroup = findHoldingGroup(
    resolveHoldingGroups({
      holdings: dashboard.holdings,
      holdingGroups: dashboard.holdingGroups,
      instruments: dashboard.instruments,
      accounts: dashboard.accounts,
    }),
    ticker,
    scopedMarketCode,
  );
  const details = await fetchTickerDetails({
    ticker,
    accountId: scopedAccountId,
    marketCode: scopedMarketCode,
    dashboard,
    transactions,
    instrument,
  });

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell isDemo={session.isDemo} initialProfile={profile} initialSidebarOpen={sidebarOpen}>
        <TickerHistoryClient
          transactions={transactions}
          dict={dict}
          locale={locale}
          ticker={ticker}
          instrument={instrument}
          isDemo={session.isDemo}
          transactionAccountFilter={scopedAccountId}
          transactionMarketFilter={scopedMarketCode}
          accountId={scopedAccountId ?? dashboard.accounts[0]?.id ?? ""}
          accounts={dashboard.accounts}
          feeProfiles={dashboard.feeProfiles}
          feeProfileBindings={dashboard.feeProfileBindings}
          details={details}
          holdingGroup={holdingGroup}
        />
      </AppShell>
    </Suspense>
  );
}
