import { Suspense } from "react";
import Link from "next/link";
import { MARKET_CODES, type InstrumentCatalogItemDto, type MarketCode, type UserSettings } from "@vakwen/shared-types";
import { getDictionary } from "../../../lib/i18n";
import { fetchDashboardPrimaryData } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { DashboardLoading } from "../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../components/layout/AppShell";
import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { TickerHistoryClient } from "./TickerHistoryClient";
import { fetchRepairInstrument } from "../../../features/settings/services/repairService";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";
import { buildPrimaryTickerDetails } from "../../../features/portfolio/services/tickerDetailsService";
import { findHoldingGroup, resolveHoldingGroups } from "../../../features/portfolio/holdingGroups";

interface TickerHistoryPageProps {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{
    accountId?: string;
    chartEnd?: string;
    chartRange?: string;
    chartStart?: string;
    marketCode?: string;
  }>;
}

function normalizeMarketCode(value?: string): MarketCode | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return (MARKET_CODES as readonly string[]).includes(normalized) ? (normalized as MarketCode) : undefined;
}

export default async function TickerHistoryPage({ params, searchParams }: TickerHistoryPageProps) {
  const [{ ticker: rawTicker }, { accountId, chartEnd, chartRange, chartStart, marketCode }, session, profile, sidebarOpen, settings] = await Promise.all([
    params,
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
  ]);
  const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();
  const scopedAccountId = accountId?.trim() ? accountId.trim() : undefined;
  const scopedMarketCode = normalizeMarketCode(marketCode);

  let dashboard: Awaited<ReturnType<typeof fetchDashboardPrimaryData>> | null = null;
  let transactions: Awaited<ReturnType<typeof fetchTransactionHistory>> = [];
  let instrument: InstrumentCatalogItemDto | null = null;

  try {
    [dashboard, transactions, instrument] = await Promise.all([
      fetchDashboardPrimaryData(),
      fetchTransactionHistory({ ticker, accountId: scopedAccountId, marketCode: scopedMarketCode }),
      fetchRepairInstrument(ticker),
    ]);
  } catch {
    // render error fallback below
  }

  if (!dashboard) {
    return (
      <Suspense fallback={<DashboardLoading standalone />}>
        <AppShell
          isDemo={session.isDemo}
          localeOverride={settings?.locale ?? "en"}
          initialProfile={profile}
          initialSidebarOpen={sidebarOpen}
        >
          <p>
            Failed to load data for {ticker}.{" "}
            <Link href="/portfolio">Back to portfolio</Link>
          </p>
        </AppShell>
      </Suspense>
    );
  }

  const locale = settings?.locale ?? dashboard.settings?.locale ?? "en";
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
  const details = buildPrimaryTickerDetails({
    ticker,
    accountId: scopedAccountId,
    marketCode: scopedMarketCode,
    dashboard,
    transactions,
    instrument,
  });
  const initialPortfolioConfig = {
    accounts: dashboard.accounts,
    feeProfiles: dashboard.feeProfiles,
    feeProfileBindings: dashboard.feeProfileBindings,
    integrityIssue: dashboard.actions.integrityIssue,
  };
  const initialTradeDate = new Date().toISOString().slice(0, 10);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialPortfolioConfig={initialPortfolioConfig}
        initialSidebarOpen={sidebarOpen}
      >
        <TickerHistoryClient
          transactions={transactions}
          dict={dict}
          locale={locale}
          ticker={ticker}
          instrument={instrument}
          isDemo={session.isDemo}
          transactionAccountFilter={scopedAccountId}
          transactionMarketFilter={scopedMarketCode}
          initialChartQuery={{
            chartEnd,
            chartRange,
            chartStart,
          }}
          initialTradeDate={initialTradeDate}
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
