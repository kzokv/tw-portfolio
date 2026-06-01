"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Landmark, Plus, ReceiptText, Wrench } from "lucide-react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  LocaleCode,
  TransactionHistoryItemDto,
  AccountDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  InstrumentCatalogItemDto,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import type { TransactionInput } from "../../../components/portfolio/types";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { RecordTransactionDialog } from "../../../components/portfolio/RecordTransactionDialog";
import { DeleteConfirmationDialog } from "../../../components/portfolio/DeleteConfirmationDialog";
import { EditConfirmationDialog } from "../../../components/portfolio/EditConfirmationDialog";
import { FeeRecalcConfirmDialog } from "../../../components/portfolio/FeeRecalcConfirmDialog";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { StatusToast } from "../../../components/ui/StatusToast";
import { FloatingStatsBubble } from "../../../components/ui/FloatingStatsBubble";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/shadcn/tabs";
import { useElementVisibility } from "../../../hooks/useFixedHeader";
import { useTransactionMutations } from "../../../features/portfolio/hooks/useTransactionMutations";
import { useTransactionSubmission } from "../../../features/portfolio/hooks/useTransactionSubmission";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import type { TickerDetailsModel } from "../../../features/portfolio/services/tickerDetailsService";
import { useEventStream } from "../../../hooks/useEventStream";
import { RepairModal, type RepairModalValue } from "../../../features/settings/components/RepairModal";
import { requestRepair } from "../../../features/settings/services/repairService";
import { getCooldownRemainingMinutes } from "../../../features/settings/utils/cooldown";
import { useSharedContextOwnerId } from "../../../hooks/useSharedContextOwnerId";
import { resolveTransactionDraftAccount } from "../../../features/dashboard/types";
import type { DashboardOverviewHoldingGroupDto } from "../../../features/portfolio/holdingGroups";
import { useBreadcrumb } from "../../../components/layout/BreadcrumbProvider";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../../lib/utils";

interface TickerHistoryClientProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  ticker: string;
  accountId: string;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  instrument: InstrumentCatalogItemDto | null;
  details: TickerDetailsModel;
  isDemo: boolean;
  transactionAccountFilter?: string;
  holdingGroup: DashboardOverviewHoldingGroupDto | null;
}

const REPAIR_EVENT_TYPES: string[] = ["repair_started", "repair_complete", "repair_failed"];

function formatLastRepairTime(locale: LocaleCode, value: Date): string {
  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatCompactNumber(locale: LocaleCode, value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(locale: LocaleCode, value: number | null): string {
  if (value == null) return "-";
  return `${formatCompactNumber(locale, value)}%`;
}

function metricValueClassName(value: string, emptyValue: string, compact = false): string {
  const size = compact ? "text-base sm:text-lg" : "text-xl sm:text-2xl";
  return value === emptyValue
    ? "mt-3 break-words text-sm font-medium leading-6 text-muted-foreground sm:text-base"
    : `mt-3 font-semibold tracking-tight text-foreground ${size}`;
}

export function TickerHistoryClient({
  transactions,
  dict,
  locale,
  ticker,
  accountId,
  accounts,
  feeProfiles,
  feeProfileBindings,
  instrument,
  details,
  isDemo,
  transactionAccountFilter,
  holdingGroup,
}: TickerHistoryClientProps) {
  const router = useRouter();
  // Per-page breadcrumb override (spec amendment #21). Display label uses the
  // instrument name + ticker symbol when available, otherwise the ticker itself.
  // The Portfolio parent segment keeps the breadcrumb actionable.
  useBreadcrumb([
    { label: dict.navigation.portfolioLabel, href: "/portfolio" },
    {
      label: instrument?.name
        ? `${instrument.name} (${ticker})`
        : ticker,
    },
  ]);
  const [isClientReady, setIsClientReady] = useState(false);
  const [isRecordDialogOpen, setIsRecordDialogOpen] = useState(false);
  const [isRepairDialogOpen, setIsRepairDialogOpen] = useState(false);
  const [isRepairSubmitting, setIsRepairSubmitting] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairError, setRepairError] = useState("");
  const [repairInProgress, setRepairInProgress] = useState(false);
  const [instrumentState, setInstrumentState] = useState<InstrumentCatalogItemDto | null>(instrument);
  const [displayTransactions, setDisplayTransactions] = useState(transactions);
  const [activeTab, setActiveTab] = useState("overview");
  const [repairValue, setRepairValue] = useState<RepairModalValue>({
    startDate: "",
    endDate: "",
    includeBars: true,
    includeDividends: true,
  });
  const sharedContextOwnerId = useSharedContextOwnerId();
  const isSharedContext = sharedContextOwnerId !== null;
  const { targetRef: statsRef, isVisible: statsVisible } = useElementVisibility();
  const currency = details.identity.currency;
  const accountNameById = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  const accountScopeDisplayName = transactionAccountFilter
    ? accountNameById.get(transactionAccountFilter) ?? transactionAccountFilter
    : dict.tickerHistory.allAccountsLabel;
  const aggregateScopeLabel = holdingGroup
    ? `${holdingGroup.marketCode} · ${formatNumber(holdingGroup.accountCount, locale)}`
    : details.identity.marketCode;

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    setInstrumentState(instrument);
  }, [instrument]);

  useEffect(() => {
    setDisplayTransactions(transactions);
  }, [transactions]);

  const refresh = useCallback(async () => {
    const nextTransactions = await fetchTransactionHistory({
      ticker,
      accountId: transactionAccountFilter,
    });
    setDisplayTransactions(nextTransactions);
    router.refresh();
  }, [router, ticker, transactionAccountFilter]);

  const handleDeleteAccepted = useCallback((transactionId: string) => {
    setDisplayTransactions((current) => current.filter((transaction) => transaction.id !== transactionId));
  }, []);

  const mutations = useTransactionMutations({
    locale,
    dict,
    refresh,
    onDeleteAccepted: handleDeleteAccepted,
  });

  const initialTransaction = useMemo<TransactionInput>(
    () =>
      resolveTransactionDraftAccount(
        {
          accountId,
          ticker,
          // KZO-169: pre-populate marketCode from the most-recent trade event
          // for this ticker. Edit-mode locks both chip + ticker (D9a) so the
          // value is fixed; on Record (instrumentReadOnly=false) the user may
          // still pivot via the chip.
          marketCode: (transactions[0]?.marketCode as TransactionInput["marketCode"]) ?? null,
          quantity: 1000,
          unitPrice: 100,
          priceCurrency: transactions[0]?.priceCurrency ?? "TWD",
          tradeDate: new Date().toISOString().slice(0, 10),
          type: "BUY",
          isDayTrade: false,
        },
        accounts,
        feeProfiles,
        feeProfileBindings,
      ),
    [accountId, accounts, feeProfileBindings, feeProfiles, ticker, transactions],
  );

  const submission = useTransactionSubmission({
    initialValue: initialTransaction,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: async () => {
      await refresh();
      setIsRecordDialogOpen(false);
    },
  });

  const handleDraftChange = useCallback(
    (next: TransactionInput) => {
      submission.setDraftTransaction(
        resolveTransactionDraftAccount(
          { ...next, ticker, accountId },
          accounts,
          feeProfiles,
          feeProfileBindings,
        ),
      );
    },
    [accountId, accounts, feeProfileBindings, feeProfiles, submission, ticker],
  );

  // KZO-169: include `defaultCurrency` so the chip default + account filter
  // pipeline in AddTransactionCard works consistently from the ticker
  // history page. `accountType` is optional metadata.
  const lockedAccountOptions = useMemo(
    () =>
      accounts
        .filter((account) => account.id === accountId)
        .map((account) => ({
          id: account.id,
          name: account.name,
          feeProfileName: feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
          defaultCurrency: account.defaultCurrency,
          accountType: account.accountType,
        })),
    [accountId, accounts, feeProfiles],
  );

  const cooldownRemaining = useMemo(() => getCooldownRemainingMinutes(instrumentState?.repairAvailableAt), [instrumentState]);
  const isBackfillBusy = instrumentState?.barsBackfillStatus === "pending" || instrumentState?.barsBackfillStatus === "backfilling";
  const repairDisabled = isDemo || isBackfillBusy || cooldownRemaining > 0 || isRepairSubmitting;
  const lastRepairAt = useMemo(() => {
    const raw = instrumentState?.lastRepairAt;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [instrumentState?.lastRepairAt]);
  const statusText = repairInProgress
    ? dict.tickerHistory.repairStatusRunning
    : lastRepairAt
      ? `${dict.tickerHistory.repairStatusLastRun}: ${formatLastRepairTime(locale, lastRepairAt)}`
      : dict.tickerHistory.repairStatusIdle;
  const repairDisabledReason = isDemo
    ? "Demo mode"
    : isBackfillBusy
      ? dict.settings.repairModeUnavailableBackfill
      : cooldownRemaining > 0
        ? dict.settings.repairModeUnavailableCooldown.replace("{minutes}", String(cooldownRemaining))
        : "";
  const quoteDirection = (details.quote.changeAmount ?? 0) >= 0 ? "up" : "down";
  const quoteAccent = quoteDirection === "up"
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : "text-rose-700 bg-rose-50 border-rose-200";
  const summaryCards = [
    {
      key: "quantity",
      label: dict.tickerHistory.quantityLabel,
      value: formatNumber(details.position.quantity, locale),
      detail: accountScopeDisplayName,
      testId: "ticker-history-quantity",
    },
    {
      key: "avgCost",
      label: dict.tickerHistory.avgCostLabel,
      value: details.position.averageCost != null
        ? formatCurrencyAmount(details.position.averageCost, currency, locale)
        : dict.tickerHistory.noHoldingData,
      detail: dict.tickerHistory.accountScopeLabel,
      testId: "ticker-history-avg-cost",
    },
    {
      key: "marketValue",
      label: dict.tickerHistory.marketValueLabel,
      value: details.position.marketValue != null
        ? formatCurrencyAmount(details.position.marketValue, currency, locale)
        : dict.tickerHistory.noHoldingData,
      detail: `${dict.tickerHistory.entriesLabel}: ${formatNumber(displayTransactions.length, locale)}`,
      testId: "ticker-history-market-value",
    },
    {
      key: "totalCost",
      label: dict.tickerHistory.totalCostLabel,
      value: details.position.costBasis != null
        ? formatCurrencyAmount(details.position.costBasis, currency, locale)
        : dict.tickerHistory.noHoldingData,
      detail: `${dict.tickerHistory.accountScopeLabel}: ${accountScopeDisplayName}`,
      testId: "ticker-history-total-cost",
    },
    {
      key: "unrealized",
      label: dict.tickerHistory.unrealizedPnlLabel,
      value: details.position.unrealizedPnl != null
        ? formatCurrencyAmount(details.position.unrealizedPnl, currency, locale)
        : dict.tickerHistory.noHoldingData,
      detail: details.quote.quoteStatus,
      testId: "ticker-history-unrealized-pnl",
    },
    {
      key: "realized",
      label: dict.tickerHistory.realizedPnlLabel,
      value: formatCurrencyAmount(details.position.realizedPnl, currency, locale),
      detail: details.position.lastDividendPostedDate
        ? formatDateLabel(details.position.lastDividendPostedDate, locale)
        : dict.tickerHistory.noHoldingData,
      testId: "ticker-history-realized-pnl",
    },
  ];
  const chartData = details.chart.points.map((point) => ({
    ...point,
    axisLabel: point.label === "Now" ? point.label : formatDateLabel(point.date, locale),
  }));
  const accountContributionData = useMemo(
    () => (holdingGroup?.children ?? []).map((child) => ({
      accountId: child.accountId,
      label: child.accountName?.trim() || child.accountId,
      quantity: child.quantity,
      averageCost: child.averageCostPerShare,
      contribution: child.marketValueAmount ?? child.costBasisAmount,
    })),
    [holdingGroup],
  );
  const floatingSummary = (
    <div className="grid gap-3 md:grid-cols-3" data-testid="ticker-floating-summary">
      <Card className="min-w-0 rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.quantityLabel}</p>
        <p className="mt-2 text-lg font-semibold text-foreground">{formatNumber(details.position.quantity, locale)}</p>
      </Card>
      <Card className="min-w-0 rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.marketValueLabel}</p>
        <p className={metricValueClassName(
          details.position.marketValue != null
            ? formatCurrencyAmount(details.position.marketValue, currency, locale)
            : dict.tickerHistory.noHoldingData,
          dict.tickerHistory.noHoldingData,
          true,
        )}>
          {details.position.marketValue != null
            ? formatCurrencyAmount(details.position.marketValue, currency, locale)
            : dict.tickerHistory.noHoldingData}
        </p>
      </Card>
      <Card className="min-w-0 rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.unrealizedPnlLabel}</p>
        <p className={metricValueClassName(
          details.position.unrealizedPnl != null
            ? formatCurrencyAmount(details.position.unrealizedPnl, currency, locale)
            : dict.tickerHistory.noHoldingData,
          dict.tickerHistory.noHoldingData,
          true,
        )}>
          {details.position.unrealizedPnl != null
            ? formatCurrencyAmount(details.position.unrealizedPnl, currency, locale)
            : dict.tickerHistory.noHoldingData}
        </p>
      </Card>
    </div>
  );

  async function handleRepairSubmit(): Promise<void> {
    setIsRepairSubmitting(true);
    setRepairMessage("");
    setRepairError("");
    try {
      const response = await requestRepair({
        tickers: [ticker],
        startDate: repairValue.startDate || undefined,
        endDate: repairValue.endDate || undefined,
        includeBars: repairValue.includeBars,
        includeDividends: repairValue.includeDividends,
      });

      if (response.queued.includes(ticker)) {
        setRepairInProgress(true);
        setRepairMessage(dict.tickerHistory.repairToastQueued);
      }
      if (response.rejected.length > 0) {
        setRepairError(response.rejected.map((item) => `${item.ticker}: ${item.reason}`).join(" | "));
      } else {
        setIsRepairDialogOpen(false);
      }
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : dict.settings.repairRequestError);
    } finally {
      setIsRepairSubmitting(false);
    }
  }

  const handleRepairEvent = useCallback(
    (eventData: unknown) => {
      const event = eventData as { type: string; ticker?: string; reason?: string };
      if (event.ticker !== ticker) return;

      if (event.type === "repair_started") {
        setRepairInProgress(true);
        setRepairMessage(dict.tickerHistory.repairStatusRunning);
      }

      if (event.type === "repair_complete") {
        setRepairInProgress(false);
        setRepairMessage(dict.tickerHistory.repairToastCompleted);
        const now = new Date();
        const nowIso = now.toISOString();
        const optimisticAvailableAt = new Date(now.getTime() + 60 * 60_000).toISOString();
        setInstrumentState((prev) =>
          prev ? { ...prev, lastRepairAt: nowIso, repairAvailableAt: optimisticAvailableAt } : prev,
        );
      }

      if (event.type === "repair_failed") {
        setRepairInProgress(false);
        setRepairError(event.reason ? `${dict.tickerHistory.repairToastFailed} ${event.reason}` : dict.tickerHistory.repairToastFailed);
      }
    },
    [ticker, dict],
  );

  useEventStream({
    eventTypes: REPAIR_EVENT_TYPES,
    enabled: true,
    onEvent: handleRepairEvent,
  });

  return (
    <>
      {isClientReady ? <div aria-hidden="true" className="sr-only" data-testid="ticker-history-client-ready" /> : null}
      <section className="grid gap-6 pb-24 sm:pb-28" data-testid="ticker-history-section">
        <Card className="overflow-hidden rounded-[30px] border border-border bg-[linear-gradient(145deg,hsla(var(--background),0.98),hsla(var(--muted),0.35))] p-0 shadow-[0_28px_70px_rgba(15,23,42,0.08)]">
          <div className="grid gap-8 px-5 py-6 sm:px-6 md:px-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.28em] text-primary/80">{dict.tickerHistory.eyebrow}</p>
                <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", quoteAccent)}>
                  {details.quote.quoteStatus}
                </span>
                {details.quote.freshness !== "current" ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    {details.quote.freshness}
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <h1 className="text-balance text-3xl font-semibold leading-tight text-foreground sm:text-4xl" data-testid="ticker-history-title">
                  {details.identity.name ? `${details.identity.name} (${ticker})` : ticker}
                </h1>
                <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  {details.identity.marketCode} · {details.identity.instrumentType ?? "Instrument"}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-4">
                <div>
                  <p className={metricValueClassName(
                    details.quote.currentPrice != null
                      ? formatCurrencyAmount(details.quote.currentPrice, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                  )}>
                    {details.quote.currentPrice != null
                      ? formatCurrencyAmount(details.quote.currentPrice, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {details.quote.previousClose != null
                      ? `${dict.tickerHistory.previousCloseLabel}: ${formatCurrencyAmount(details.quote.previousClose, currency, locale)}`
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className={cn("rounded-2xl border px-4 py-3 text-sm", quoteAccent)} data-testid="ticker-quote-change">
                  <div className="flex items-center gap-2 font-medium">
                    {quoteDirection === "up" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    <span>{details.quote.changeAmount != null ? formatCurrencyAmount(details.quote.changeAmount, currency, locale) : "-"}</span>
                    <span>{formatPercent(locale, details.quote.changePercent)}</span>
                  </div>
                  <p className="mt-1 text-xs opacity-80" data-testid="repair-status-badge">{statusText}</p>
                </div>
              </div>
              {details.quote.freshnessTooltip ? (
              <p className="mt-3 text-sm text-muted-foreground">{details.quote.freshnessTooltip}</p>
            ) : null}
          </div>

            <Card className="rounded-[26px] border-border bg-background/90 p-5 shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.floatingSummaryTitle}</p>
                  <p className={metricValueClassName(
                    details.position.marketValue != null
                      ? formatCurrencyAmount(details.position.marketValue, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {details.position.marketValue != null
                      ? formatCurrencyAmount(details.position.marketValue, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <BarChart3 className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.quantityLabel}</p>
                  <p className="mt-1 text-base font-semibold text-foreground">{formatNumber(details.position.quantity, locale)}</p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.totalCostLabel}</p>
                  <p className={metricValueClassName(
                    details.position.costBasis != null
                      ? formatCurrencyAmount(details.position.costBasis, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {details.position.costBasis != null
                      ? formatCurrencyAmount(details.position.costBasis, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.unrealizedPnlLabel}</p>
                  <p className={metricValueClassName(
                    details.position.unrealizedPnl != null
                      ? formatCurrencyAmount(details.position.unrealizedPnl, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {details.position.unrealizedPnl != null
                      ? formatCurrencyAmount(details.position.unrealizedPnl, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.nextDividendLabel}</p>
                  <p className={metricValueClassName(
                    details.dividends.nextPaymentDate
                      ? formatDateLabel(details.dividends.nextPaymentDate, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {details.dividends.nextPaymentDate
                      ? formatDateLabel(details.dividends.nextPaymentDate, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/portfolio"
                  className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm text-primary transition hover:border-primary/40 hover:bg-primary/10"
                >
                  {dict.tickerHistory.backToDashboard}
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => setIsRepairDialogOpen(true)}
                  disabled={repairDisabled}
                  className="gap-1.5"
                  title={repairDisabledReason || dict.tickerHistory.repairButtonCooldownTooltip}
                  data-testid="repair-button"
                >
                  <Wrench className="h-4 w-4" />
                  {dict.tickerHistory.repairAction}
                </Button>
                {!isSharedContext ? (
                  <Button onClick={() => setIsRecordDialogOpen(true)} data-testid="record-transaction-button" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    {dict.tickerHistory.recordTransaction}
                  </Button>
                ) : null}
              </div>
            </Card>
          </div>
        </Card>

        <div ref={statsRef} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="ticker-stats-bar">
          {summaryCards.map((card) => (
            <Card key={card.key} className="min-w-0 rounded-[24px] border-border bg-background/90 p-5 shadow-[0_14px_28px_rgba(148,163,184,0.1)]" data-testid={card.testId}>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{card.label}</p>
              <p className={metricValueClassName(card.value, dict.tickerHistory.noHoldingData)}>{card.value}</p>
              <p className="mt-2 break-words text-sm text-muted-foreground">{card.detail}</p>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="grid gap-6">
          <TabsList className="w-full justify-start overflow-x-auto rounded-2xl bg-slate-100/90 p-1.5">
            <TabsTrigger value="overview" data-testid="ticker-tab-overview" className="rounded-xl px-4 py-2">
              <BarChart3 className="mr-2 h-4 w-4" />
              {dict.tickerHistory.overviewTabLabel}
            </TabsTrigger>
            <TabsTrigger value="fundamentals" data-testid="ticker-tab-fundamentals" className="rounded-xl px-4 py-2">
              <Landmark className="mr-2 h-4 w-4" />
              {dict.tickerHistory.fundamentalsTabLabel}
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="ticker-tab-transactions" className="rounded-xl px-4 py-2">
              <ReceiptText className="mr-2 h-4 w-4" />
              {dict.tickerHistory.transactionsTabLabel}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)]">
            <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]" data-testid="ticker-detail-chart">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.chartTitle}</p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">{dict.tickerHistory.chartSubtitle}</h2>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                  {details.identity.currency}
                </div>
              </div>
              <div className="mt-6 h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                    <XAxis dataKey="axisLabel" tickLine={false} axisLine={false} minTickGap={32} />
                    <YAxis tickLine={false} axisLine={false} width={90} tickFormatter={(value) => formatCompactNumber(locale, value)} />
                    <Tooltip
                      formatter={(value, name) => {
                        if (typeof value !== "number") return Array.isArray(value) ? value.join(" / ") : value;
                        if (name === "quantity") return formatNumber(value, locale);
                        return formatCurrencyAmount(value, currency, locale);
                      }}
                    />
                    <Line type="monotone" dataKey="price" stroke="#0f766e" strokeWidth={2.5} dot={false} name={dict.tickerHistory.currentPriceLabel} />
                    <Line type="monotone" dataKey="averageCost" stroke="#334155" strokeWidth={2} strokeDasharray="6 4" dot={false} name={dict.tickerHistory.avgCostLabel} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid gap-6">
              <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.dividendsPanelTitle}</p>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.upcomingDividendsLabel}</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{formatNumber(details.dividends.upcomingCount, locale)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.nextDividendLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {details.dividends.nextPaymentDate
                        ? formatDateLabel(details.dividends.nextPaymentDate, locale)
                        : dict.tickerHistory.noHoldingData}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.lastDividendLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {details.dividends.lastPostedDate
                        ? formatDateLabel(details.dividends.lastPostedDate, locale)
                        : dict.tickerHistory.noHoldingData}
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.positionSummaryTitle}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.accountScopeLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{accountScopeDisplayName}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.aggregateScopeLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{aggregateScopeLabel}</p>
                  </div>
                </div>
              </Card>
              <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]" data-testid="ticker-account-breakdown">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.accountBreakdownTitle}</p>
                <h3 className="mt-2 text-base font-semibold text-slate-950">{dict.tickerHistory.accountBreakdownContributionTitle}</h3>
                <p className="mt-1 text-sm text-slate-500">{dict.tickerHistory.accountBreakdownSubtitle}</p>
                {accountContributionData.length === 0 ? (
                  <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{dict.tickerHistory.accountBreakdownEmpty}</p>
                ) : (
                  <>
                    <div className="mt-4 h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={accountContributionData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="label" width={88} tickLine={false} axisLine={false} />
                          <Tooltip formatter={(value) => typeof value === "number" ? formatCurrencyAmount(value, currency, locale) : value} />
                          <Bar dataKey="contribution" fill="#2563eb" radius={[6, 6, 6, 6]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5">{dict.tickerHistory.accountBreakdownAccountLabel}</th>
                            <th className="px-4 py-2.5 text-right">{dict.tickerHistory.quantityLabel}</th>
                            <th className="px-4 py-2.5 text-right">{dict.tickerHistory.avgCostLabel}</th>
                            <th className="px-4 py-2.5 text-right">{dict.tickerHistory.accountContributionLabel}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accountContributionData.map((row) => (
                            <tr key={row.accountId} className="border-t border-slate-200">
                              <td className="px-4 py-3 font-medium text-slate-900">{row.label}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{formatNumber(row.quantity, locale)}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{formatCurrencyAmount(row.averageCost, currency, locale)}</td>
                              <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCurrencyAmount(row.contribution, currency, locale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="fundamentals" className="mt-0 grid gap-6 lg:grid-cols-2" data-testid="ticker-detail-fundamentals">
            {details.fundamentals.panels.map((panel) => (
              <Card key={panel.key} className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{panel.title}</p>
                <div className="mt-4 grid gap-3">
                  {panel.items.map((item) => (
                    <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-500">{item.label}</p>
                          <p className="mt-1 text-base font-semibold text-slate-950">
                            {typeof item.value === "number"
                              ? formatCompactNumber(locale, item.value)
                              : item.value ?? dict.tickerHistory.fundamentalsUnavailable}
                          </p>
                        </div>
                        {(item.source || item.asOf) ? (
                          <div className="text-right text-[11px] text-slate-400">
                            <p>{item.source ?? ""}</p>
                            <p>{item.asOf ? formatDateLabel(item.asOf, locale) : ""}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="transactions" className="mt-0 grid gap-6" data-testid="ticker-detail-transactions">
            {isSharedContext ? (
              <div
                className="rounded-[22px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700"
                data-testid="ticker-history-readonly"
                role="status"
                aria-live="polite"
              >
                {dict.switcher.readonlyDescription}
              </div>
            ) : null}
            <TransactionHistoryTable
              transactions={displayTransactions}
              dict={dict}
              locale={locale}
              onDeleteRequest={isSharedContext ? undefined : mutations.startDelete}
              editingId={isSharedContext ? null : mutations.editingId}
              onEditStart={isSharedContext ? undefined : mutations.startEdit}
              onEditCancel={isSharedContext ? undefined : mutations.cancelEdit}
              onEditSave={isSharedContext ? undefined : mutations.submitEdit}
              recomputingIds={mutations.recomputingIds}
            />
          </TabsContent>
        </Tabs>
      </section>

      <FloatingStatsBubble visible={!statsVisible}>{floatingSummary}</FloatingStatsBubble>

      <RecordTransactionDialog
        open={isRecordDialogOpen}
        onOpenChange={setIsRecordDialogOpen}
        value={submission.draftTransaction}
        onChange={handleDraftChange}
        onUnitPriceEdited={submission.markUnitPriceEdited}
        onSubmit={async () => {
          await submission.submit();
        }}
        pending={submission.isSubmitting}
        accountOptions={lockedAccountOptions}
        message={submission.message}
        errorMessage={submission.errorMessage}
        title={dict.tickerHistory.recordTransaction}
        dict={dict}
        locale={locale}
        instrumentReadOnly
        priceHint={submission.priceHint}
        showPriceUnavailableHint={submission.showPriceUnavailableHint}
        feeEstimate={submission.feeEstimate}
      />

      <RepairModal
        open={isRepairDialogOpen}
        pending={isRepairSubmitting}
        title={`${dict.tickerHistory.repairAction} ${ticker}`}
        subtitle={statusText}
        value={repairValue}
        onOpenChange={setIsRepairDialogOpen}
        onChange={setRepairValue}
        onSubmit={handleRepairSubmit}
        dict={dict}
      />

      <DeleteConfirmationDialog
        open={mutations.isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelDelete();
        }}
        transaction={mutations.deleteTarget}
        preview={mutations.deletePreview}
        isLoading={mutations.isDeletePreviewLoading}
        onConfirm={mutations.confirmDelete}
        dict={dict}
        locale={locale}
      />
      <EditConfirmationDialog
        open={mutations.isEditPreviewOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelEditPreview();
        }}
        preview={mutations.editPreview}
        isLoading={mutations.isEditPreviewLoading}
        dict={dict}
        locale={locale}
      />
      <FeeRecalcConfirmDialog
        open={mutations.isFeeConfirmOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelEdit();
        }}
        onRecalculate={mutations.confirmFeeRecalc}
        onKeepManual={mutations.keepManualFees}
        dict={dict}
      />

      <StatusToast message={mutations.message} variant="success" testId="mutation-status" />
      <StatusToast message={mutations.errorMessage} variant="error" testId="mutation-error" />
      <StatusToast message={repairMessage} variant="success" testId="repair-status" />
      <StatusToast message={repairError} variant="error" testId="repair-error" />
    </>
  );
}
