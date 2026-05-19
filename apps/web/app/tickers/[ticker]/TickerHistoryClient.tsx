"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
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
import { StatusToast } from "../../../components/ui/StatusToast";
import { FloatingStatsBubble } from "../../../components/ui/FloatingStatsBubble";
import { useElementVisibility } from "../../../hooks/useFixedHeader";
import { useTransactionMutations } from "../../../features/portfolio/hooks/useTransactionMutations";
import { useTransactionSubmission } from "../../../features/portfolio/hooks/useTransactionSubmission";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { useEventStream } from "../../../hooks/useEventStream";
import { RepairModal, type RepairModalValue } from "../../../features/settings/components/RepairModal";
import { requestRepair } from "../../../features/settings/services/repairService";
import { getCooldownRemainingMinutes } from "../../../features/settings/utils/cooldown";
import { useSharedContextOwnerId } from "../../../hooks/useSharedContextOwnerId";
import { resolveTransactionDraftAccount } from "../../../features/dashboard/types";
import { useBreadcrumb } from "../../../components/layout/BreadcrumbProvider";

interface TickerHistoryClientProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  ticker: string;
  accountId: string;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  statsBar: React.ReactNode;
  instrument: InstrumentCatalogItemDto | null;
  isDemo: boolean;
  transactionAccountFilter?: string;
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

export function TickerHistoryClient({
  transactions,
  dict,
  locale,
  ticker,
  accountId,
  accounts,
  feeProfiles,
  feeProfileBindings,
  statsBar,
  instrument,
  isDemo,
  transactionAccountFilter,
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
  const [repairValue, setRepairValue] = useState<RepairModalValue>({
    startDate: "",
    endDate: "",
    includeBars: true,
    includeDividends: true,
  });
  const sharedContextOwnerId = useSharedContextOwnerId();
  const isSharedContext = sharedContextOwnerId !== null;
  const { targetRef: statsRef, isVisible: statsVisible } = useElementVisibility();

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
      <section className="rounded-xl border border-border bg-card px-5 py-6 text-card-foreground shadow-sm sm:px-6 sm:py-7 md:px-8" data-testid="ticker-history-section">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.28em] text-primary/80">{dict.tickerHistory.eyebrow}</p>
            <h1 className="mt-3 text-3xl leading-tight text-foreground sm:text-4xl" data-testid="ticker-history-title">
              {ticker}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="repair-status-badge">
              {statusText}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        </div>

        {isSharedContext ? (
          <div
            className="mt-6 rounded-[22px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700"
            data-testid="ticker-history-readonly"
            role="status"
            aria-live="polite"
          >
            {dict.switcher.readonlyDescription}
          </div>
        ) : null}

        <div ref={statsRef} className="mt-6">
          {statsBar}
        </div>
      </section>

      <FloatingStatsBubble visible={!statsVisible}>{statsBar}</FloatingStatsBubble>

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

      <div className="mt-6">
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
      </div>

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
