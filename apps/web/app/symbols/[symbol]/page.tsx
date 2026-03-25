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
import { SymbolHistoryClient } from "./SymbolHistoryClient";
import type { DashboardOverviewHoldingDto } from "@tw-portfolio/shared-types";

interface SymbolHistoryPageProps {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ accountId?: string }>;
}

export default async function SymbolHistoryPage({ params, searchParams }: SymbolHistoryPageProps) {
  const [{ symbol: rawSymbol }, { accountId }, session] = await Promise.all([
    params,
    searchParams,
    requireSession(),
  ]);
  const symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();
  const scopedAccountId = accountId?.trim() ? accountId.trim() : undefined;

  let dashboard: Awaited<ReturnType<typeof fetchDashboardSnapshot>> | null = null;
  let transactions: Awaited<ReturnType<typeof fetchTransactionHistory>> = [];

  try {
    [dashboard, transactions] = await Promise.all([
      fetchDashboardSnapshot(),
      fetchTransactionHistory({ symbol, accountId: scopedAccountId }),
    ]);
  } catch {
    // render error fallback below
  }

  if (!dashboard) {
    return (
      <Suspense fallback={<DashboardLoading standalone />}>
        <AppShell isDemo={session.isDemo}>
          <p>
            Failed to load data for {symbol}.{" "}
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
    (h) => h.symbol === symbol && (!scopedAccountId || h.accountId === scopedAccountId),
  );
  const currency = holding?.currency ?? latestTrade?.priceCurrency ?? "TWD";
  const noData = dict.symbolHistory.noHoldingData;

  const statsBar = (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="symbol-stats-bar">
      <StatChip label={dict.symbolHistory.accountScopeLabel} value={scopedAccountId ?? dict.symbolHistory.allAccountsLabel} testId="symbol-history-account-scope" />
      <StatChip label={dict.symbolHistory.entriesLabel} value={formatNumber(transactions.length, locale)} />
      <StatChip label={dict.symbolHistory.quantityLabel} value={holding ? formatNumber(holding.quantity, locale) : noData} />
      <StatChip label={dict.symbolHistory.avgCostLabel} value={holding ? formatCurrencyAmount(holding.averageCostPerShare, currency, locale) : noData} />
      <StatChip label={dict.symbolHistory.marketValueLabel} value={holding?.marketValueAmount != null ? formatCurrencyAmount(holding.marketValueAmount, currency, locale) : noData} />
      <StatChip label={dict.symbolHistory.totalCostLabel} value={holding ? formatCurrencyAmount(holding.costBasisAmount, currency, locale) : noData} />
      <StatChip
        label={dict.symbolHistory.realizedPnlLabel}
        value={formatCurrencyAmount(realizedPnlTotal, currency, locale)}
        detail={latestTrade?.tradeDate ? formatDateLabel(latestTrade.tradeDate, locale) : undefined}
      />
    </div>
  );

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell isDemo={session.isDemo}>
        <SymbolHistoryClient
          transactions={transactions}
          dict={dict}
          locale={locale}
          symbol={symbol}
          accountId={scopedAccountId ?? dashboard.accounts[0]?.id ?? ""}
          accounts={dashboard.accounts}
          symbolOptions={dashboard.symbols}
          statsBar={statsBar}
        />
      </AppShell>
    </Suspense>
  );
}
