"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import type { LocaleCode, TransactionHistoryItemDto, AccountDto, InstrumentCatalogItemDto } from "@tw-portfolio/shared-types";
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
import { useEventStream } from "../../../hooks/useEventStream";
import { RepairModal, type RepairModalValue } from "../../../features/settings/components/RepairModal";
import { requestRepair } from "../../../features/settings/services/repairService";
import { getCooldownRemainingMinutes } from "../../../features/settings/utils/cooldown";
import { useSharedContextOwnerId } from "../../../hooks/useSharedContextOwnerId";

interface TickerHistoryClientProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  ticker: string;
  accountId: string;
  accounts: AccountDto[];
  statsBar: React.ReactNode;
  instrument: InstrumentCatalogItemDto | null;
  isDemo: boolean;
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
  statsBar,
  instrument,
  isDemo,
}: TickerHistoryClientProps) {
  const router = useRouter();
  const [isClientReady, setIsClientReady] = useState(false);
  const [isRecordDialogOpen, setIsRecordDialogOpen] = useState(false);
  const [isRepairDialogOpen, setIsRepairDialogOpen] = useState(false);
  const [isRepairSubmitting, setIsRepairSubmitting] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairError, setRepairError] = useState("");
  const [repairInProgress, setRepairInProgress] = useState(false);
  const [instrumentState, setInstrumentState] = useState<InstrumentCatalogItemDto | null>(instrument);
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

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const mutations = useTransactionMutations({ locale, dict, refresh });

  const defaultCurrency = transactions[0]?.priceCurrency ?? "TWD";
  const initialTransaction: TransactionInput = {
    accountId,
    ticker,
    quantity: 1000,
    unitPrice: 100,
    priceCurrency: defaultCurrency,
    tradeDate: new Date().toISOString().slice(0, 10),
    type: "BUY",
    isDayTrade: false,
  };

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
      submission.setDraftTransaction({ ...next, ticker, accountId });
    },
    [ticker, accountId, submission],
  );

  const lockedAccountOptions = accounts.filter((account) => account.id === accountId).map((account) => ({ id: account.id, name: account.name }));

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
      <section className="glass-panel rounded-[30px] px-5 py-6 shadow-glass sm:px-6 sm:py-7 md:px-8" data-testid="ticker-history-section">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.28em] text-indigo-500/78">{dict.tickerHistory.eyebrow}</p>
            <h1 className="mt-3 text-3xl leading-tight text-slate-950 sm:text-4xl" data-testid="ticker-history-title">
              {ticker}
            </h1>
            <p className="mt-2 text-xs text-slate-500" data-testid="repair-status-badge">
              {statusText}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/portfolio"
              className="inline-flex items-center justify-center rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
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
        onSubmit={submission.submit}
        pending={submission.isSubmitting}
        accountOptions={lockedAccountOptions}
        message={submission.message}
        errorMessage={submission.errorMessage}
        title={dict.tickerHistory.recordTransaction}
        dict={dict}
        tickerReadOnly
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
          transactions={transactions}
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
