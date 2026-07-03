import React, { Suspense } from "react";
import Link from "next/link";
import { MARKET_CODES, TICKER_CHART_RANGES, type InstrumentCatalogItemDto, type MarketCode, type TickerChartRange, type UserSettings } from "@vakwen/shared-types";
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
    includeProvisional?: string;
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

function normalizeAnalysisIncludeProvisional(source?: string, value?: string): boolean | undefined {
  if (source !== "unrealized-pnl-analysis") return undefined;
  return value?.trim().toLowerCase() === "true";
}

function normalizeTickerChartRange(value?: string): TickerChartRange | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return (TICKER_CHART_RANGES as readonly string[]).includes(normalized) ? (normalized as TickerChartRange) : undefined;
}

export default async function TickerHistoryPage({ params, searchParams }: TickerHistoryPageProps) {
  const [{ ticker: rawTicker }, { accountId, accountIds, chartEnd, chartRange, chartStart, fromDate, includeProvisional, marketCode, source, toDate }, session, profile, sidebarOpen, settings] = await Promise.all([
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
  const explicitChartRange = chartRange?.trim() ? chartRange.trim().toUpperCase() : undefined;
  const explicitTickerChartRange = normalizeTickerChartRange(explicitChartRange);
  const explicitChartStart = chartStart?.trim() || undefined;
  const explicitChartEnd = chartEnd?.trim() || undefined;
  const shouldUseAnalysisDateAlias = openedFromUnrealizedPnlAnalysis && !explicitChartRange && !explicitChartStart && !explicitChartEnd;
  const initialChartRange = explicitChartRange ?? (shouldUseAnalysisDateAlias && fromDate && toDate ? "CUSTOM" : undefined);
  const initialChartStart = explicitChartStart ?? (shouldUseAnalysisDateAlias ? fromDate : undefined);
  const initialChartEnd = explicitChartEnd ?? (shouldUseAnalysisDateAlias ? toDate : undefined);
  const initialPrimaryRange = explicitTickerChartRange;
  const initialPrimaryStart = initialChartRange === "CUSTOM" ? initialChartStart : undefined;
  const initialPrimaryEnd = initialChartRange === "CUSTOM" ? initialChartEnd : undefined;
  const analysisIncludeProvisional = normalizeAnalysisIncludeProvisional(source, includeProvisional);
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
    range: initialPrimaryRange,
    startDate: initialPrimaryStart,
    endDate: initialPrimaryEnd,
    includeProvisional: analysisIncludeProvisional,
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
          accounts={dashboard.accounts}
          feeProfiles={dashboard.feeProfiles}
          feeProfileBindings={dashboard.feeProfileBindings}
          details={details}
        />
      </AppShell>
    </Suspense>
  );
}
