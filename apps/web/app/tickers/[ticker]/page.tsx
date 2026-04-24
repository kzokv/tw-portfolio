import { Suspense } from "react";
import Link from "next/link";
import { getDictionary } from "../../../lib/i18n";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { formatCurrencyAmount, formatDateLabel, formatNumber } from "../../../lib/utils";
import { DashboardLoading } from "../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../components/layout/AppShell";
import { StatChip } from "../../../components/ui/StatChip";
import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { TickerHistoryClient } from "./TickerHistoryClient";
import type { DashboardOverviewHoldingDto } from "@tw-portfolio/shared-types";
import { fetchRepairInstrument } from "../../../features/settings/services/repairService";
import type { InstrumentCatalogItemDto } from "@tw-portfolio/shared-types";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";

interface TickerHistoryPageProps {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ accountId?: string }>;
}

export default async function TickerHistoryPage({ params, searchParams }: TickerHistoryPageProps) {
  const [{ ticker: rawTicker }, { accountId }, session, profile] = await Promise.all([
    params,
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
  ]);
  const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();
  const scopedAccountId = accountId?.trim() ? accountId.trim() : undefined;

  let dashboard: Awaited<ReturnType<typeof fetchDashboardSnapshot>> | null = null;
  let transactions: Awaited<ReturnType<typeof fetchTransactionHistory>> = [];
  let instrument: InstrumentCatalogItemDto | null = null;

  try {
    [dashboard, transactions, instrument] = await Promise.all([
      fetchDashboardSnapshot(),
      fetchTransactionHistory({ ticker, accountId: scopedAccountId }),
      fetchRepairInstrument(ticker),
    ]);
  } catch {
    // render error fallback below
  }

  if (!dashboard) {
    return (
      <Suspense fallback={<DashboardLoading standalone />}>
        <AppShell isDemo={session.isDemo} initialProfile={profile}>
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
  const latestTrade = transactions[0] ?? null;
  const realizedPnlTotal = transactions.reduce((sum, tx) => sum + (tx.realizedPnlAmount ?? 0), 0);

  const holding: DashboardOverviewHoldingDto | undefined = dashboard.holdings.find(
    (holdingItem) => holdingItem.ticker === ticker && (!scopedAccountId || holdingItem.accountId === scopedAccountId),
  );
  const currency = holding?.currency ?? latestTrade?.priceCurrency ?? "TWD";
  const noData = dict.tickerHistory.noHoldingData;

  const statsBar = (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="ticker-stats-bar">
      <StatChip label={dict.tickerHistory.accountScopeLabel} value={scopedAccountId ?? dict.tickerHistory.allAccountsLabel} testId="ticker-history-account-scope" />
      <StatChip label={dict.tickerHistory.entriesLabel} value={formatNumber(transactions.length, locale)} testId="ticker-history-entries" />
      <StatChip label={dict.tickerHistory.quantityLabel} value={holding ? formatNumber(holding.quantity, locale) : noData} testId="ticker-history-quantity" />
      <StatChip label={dict.tickerHistory.avgCostLabel} value={holding ? formatCurrencyAmount(holding.averageCostPerShare, currency, locale) : noData} testId="ticker-history-avg-cost" />
      <StatChip label={dict.tickerHistory.marketValueLabel} value={holding?.marketValueAmount != null ? formatCurrencyAmount(holding.marketValueAmount, currency, locale) : noData} testId="ticker-history-market-value" />
      <StatChip label={dict.tickerHistory.totalCostLabel} value={holding ? formatCurrencyAmount(holding.costBasisAmount, currency, locale) : noData} testId="ticker-history-total-cost" />
      <StatChip
        label={dict.tickerHistory.realizedPnlLabel}
        value={formatCurrencyAmount(realizedPnlTotal, currency, locale)}
        detail={latestTrade?.tradeDate ? formatDateLabel(latestTrade.tradeDate, locale) : undefined}
        testId="ticker-history-realized-pnl"
      />
    </div>
  );

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell isDemo={session.isDemo} initialProfile={profile}>
        <TickerHistoryClient
          transactions={transactions}
          dict={dict}
          locale={locale}
          ticker={ticker}
          instrument={instrument}
          isDemo={session.isDemo}
          accountId={scopedAccountId ?? dashboard.accounts[0]?.id ?? ""}
          accounts={dashboard.accounts}
          feeProfiles={dashboard.feeProfiles}
          feeProfileBindings={dashboard.feeProfileBindings}
          statsBar={statsBar}
        />
      </AppShell>
    </Suspense>
  );
}
