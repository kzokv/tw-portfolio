import React, { Suspense } from "react";
import Link from "next/link";
import { MARKET_CODES, type InstrumentCatalogItemDto, type MarketCode, type UserSettings } from "@vakwen/shared-types";
import { getDictionary } from "../../../lib/i18n";
import { fetchDashboardPrimaryData } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { DashboardLoading } from "../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../../components/layout/i18n";
import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { TickerHistoryClient } from "./TickerHistoryClient";
import { fetchRepairInstrument } from "../../../features/settings/services/repairService";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";
import { buildPrimaryTickerDetails, fetchTickerPrimaryDetails } from "../../../features/portfolio/services/tickerDetailsService";

interface TickerHistoryPageProps {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{
    accountId?: string;
    accountIds?: string | string[];
    chartEnd?: string;
    chartRange?: string;
    chartStart?: string;
    fromDate?: string;
    marketCode?: string;
    source?: string;
    toDate?: string;
  }>;
}

function normalizeMarketCode(value?: string): MarketCode | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return (MARKET_CODES as readonly string[]).includes(normalized) ? (normalized as MarketCode) : undefined;
}

function normalizeAccountIdsQueryValue(value?: string | string[]): string[] | undefined {
  if (value === undefined) return undefined;
  const accountIds = (Array.isArray(value) ? value : [value])
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return accountIds.length > 0 ? accountIds : undefined;
}

export default async function TickerHistoryPage({ params, searchParams }: TickerHistoryPageProps) {
  const [{ ticker: rawTicker }, { accountId, accountIds, chartEnd, chartRange, chartStart, fromDate, marketCode, source, toDate }, session, profile, sidebarOpen, settings] = await Promise.all([
    params,
    searchParams,
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
  ]);
  const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();
  const scopedAccountId = accountId?.trim() ? accountId.trim() : undefined;
  const scopedAccountIds = !scopedAccountId ? normalizeAccountIdsQueryValue(accountIds) : undefined;
  const scopedMarketCode = normalizeMarketCode(marketCode);
  const openedFromUnrealizedPnlAnalysis = source === "unrealized-pnl-analysis";
  const initialChartRange = openedFromUnrealizedPnlAnalysis && fromDate && toDate ? "CUSTOM" : chartRange;
  const initialChartStart = openedFromUnrealizedPnlAnalysis && fromDate ? fromDate : chartStart;
  const initialChartEnd = openedFromUnrealizedPnlAnalysis && toDate ? toDate : chartEnd;
  const locale = settings?.locale ?? "en";
  const dict = getDictionary(locale);
  const loadingCopy = getRouteLoadingLabels(locale).tickerDetail;

  let dashboard: Awaited<ReturnType<typeof fetchDashboardPrimaryData>> | null = null;
  let transactions: Awaited<ReturnType<typeof fetchTransactionHistory>> = [];
  let instrument: InstrumentCatalogItemDto | null = null;

  try {
    [dashboard, transactions, instrument] = await Promise.all([
      fetchDashboardPrimaryData(),
      fetchTransactionHistory({ ticker, accountId: scopedAccountId, accountIds: scopedAccountIds, marketCode: scopedMarketCode }),
      fetchRepairInstrument(ticker),
    ]);
  } catch {
    // render error fallback below
  }

  if (!dashboard) {
    return (
      <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
        <AppShell
          isDemo={session.isDemo}
          localeOverride={locale}
          initialProfile={profile}
          initialSidebarOpen={sidebarOpen}
        >
          <p>
            {dict.tickerHistory.loadError.replace("{ticker}", ticker)}{" "}
            <Link href="/portfolio">{dict.tickerHistory.backToPortfolio}</Link>
          </p>
        </AppShell>
      </Suspense>
    );
  }

  const resolvedLocale = settings?.locale ?? dashboard.settings?.locale ?? locale;
  const resolvedDict = getDictionary(resolvedLocale);
  const primaryDetails = buildPrimaryTickerDetails({
    ticker,
    accountId: scopedAccountId,
    accountIds: scopedAccountIds,
    marketCode: scopedMarketCode,
    dashboard,
    transactions,
    instrument,
  });
  const details = await fetchTickerPrimaryDetails({
    ticker,
    accountId: scopedAccountId,
    accountIds: scopedAccountIds,
    marketCode: scopedMarketCode,
    instrument,
    transactions,
    primaryDetails,
  });
  const initialPortfolioConfig = {
    accounts: dashboard.accounts,
    feeProfiles: dashboard.feeProfiles,
    feeProfileBindings: dashboard.feeProfileBindings,
    integrityIssue: dashboard.actions.integrityIssue,
  };
  const initialTradeDate = new Date().toISOString().slice(0, 10);
  const scopedRecordAccountId = scopedAccountIds?.find((accountId) => dashboard.accounts.some((account) => account.id === accountId));
  const recordAccountId = scopedAccountId ?? scopedRecordAccountId ?? dashboard.accounts[0]?.id ?? "";

  return (
    <Suspense fallback={<DashboardLoading standalone locale={resolvedLocale} loadingCopy={getRouteLoadingLabels(resolvedLocale).tickerDetail} />}>
      <AppShell
        isDemo={session.isDemo}
        localeOverride={resolvedLocale}
        initialProfile={profile}
        initialPortfolioConfig={initialPortfolioConfig}
        initialSidebarOpen={sidebarOpen}
      >
        <TickerHistoryClient
          transactions={transactions}
          dict={resolvedDict}
          locale={resolvedLocale}
          ticker={ticker}
          instrument={instrument}
          isDemo={session.isDemo}
          transactionAccountFilter={scopedAccountId}
          transactionAccountIdsFilter={scopedAccountIds}
          transactionMarketFilter={scopedMarketCode}
          initialChartQuery={{
            chartEnd: initialChartEnd,
            chartRange: initialChartRange,
            chartStart: initialChartStart,
          }}
          initialTradeDate={initialTradeDate}
          quotePollIntervalSeconds={settings?.quotePollIntervalSeconds ?? dashboard.settings?.quotePollIntervalSeconds}
          tickerPriceIntradayEnabled={settings?.effectiveTickerPriceIntradayEnabled ?? dashboard.settings?.effectiveTickerPriceIntradayEnabled}
          tickerPriceIntradayRefreshIntervalMinutes={settings?.effectiveTickerPriceIntradayRefreshIntervalMinutes ?? dashboard.settings?.effectiveTickerPriceIntradayRefreshIntervalMinutes}
          accountId={recordAccountId}
          accounts={dashboard.accounts}
          feeProfiles={dashboard.feeProfiles}
          feeProfileBindings={dashboard.feeProfileBindings}
          details={details}
        />
      </AppShell>
    </Suspense>
  );
}
