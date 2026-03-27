"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { LocaleCode, TransactionHistoryItemDto, SymbolOptionDto, AccountDto } from "@tw-portfolio/shared-types";
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

interface TickerHistoryClientProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  ticker: string;
  accountId: string;
  accounts: AccountDto[];
  symbolOptions: SymbolOptionDto[];
  statsBar: React.ReactNode;
}

export function TickerHistoryClient({
  transactions,
  dict,
  locale,
  ticker,
  accountId,
  accounts,
  symbolOptions,
  statsBar,
}: TickerHistoryClientProps) {
  const router = useRouter();
  const [isClientReady, setIsClientReady] = useState(false);
  const [isRecordDialogOpen, setIsRecordDialogOpen] = useState(false);
  const { targetRef: statsRef, isVisible: statsVisible } = useElementVisibility();

  useEffect(() => {
    setIsClientReady(true);
  }, []);

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

  const lockedTickerOptions = symbolOptions.filter((option) => option.ticker === ticker);
  const lockedAccountOptions = accounts
    .filter((account) => account.id === accountId)
    .map((account) => ({ id: account.id, name: account.name }));

  return (
    <>
      {isClientReady ? <div aria-hidden="true" className="sr-only" data-testid="ticker-history-client-ready" /> : null}
      <section
        className="glass-panel rounded-[30px] px-5 py-6 shadow-glass sm:px-6 sm:py-7 md:px-8"
        data-testid="symbol-history-section"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.28em] text-indigo-500/78">{dict.symbolHistory.eyebrow}</p>
            <h1 className="mt-3 text-3xl leading-tight text-slate-950 sm:text-4xl" data-testid="symbol-history-title">
              {ticker}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/portfolio"
              className="inline-flex items-center justify-center rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              {dict.symbolHistory.backToDashboard}
            </Link>
            <Button
              onClick={() => setIsRecordDialogOpen(true)}
              data-testid="record-transaction-button"
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {dict.symbolHistory.recordTransaction}
            </Button>
          </div>
        </div>

        <div ref={statsRef} className="mt-6">
          {statsBar}
        </div>
      </section>

      <FloatingStatsBubble visible={!statsVisible}>
        {statsBar}
      </FloatingStatsBubble>

      <RecordTransactionDialog
        open={isRecordDialogOpen}
        onOpenChange={setIsRecordDialogOpen}
        value={submission.draftTransaction}
        onChange={handleDraftChange}
        onSubmit={submission.submit}
        pending={submission.isSubmitting}
        accountOptions={lockedAccountOptions}
        symbolOptions={lockedTickerOptions.length > 0 ? lockedTickerOptions : symbolOptions}
        message={submission.message}
        errorMessage={submission.errorMessage}
        title={dict.symbolHistory.recordTransaction}
        dict={dict}
      />

      <div className="mt-6">
        <TransactionHistoryTable
          transactions={transactions}
          dict={dict}
          locale={locale}
          onDeleteRequest={mutations.startDelete}
          editingId={mutations.editingId}
          onEditStart={mutations.startEdit}
          onEditCancel={mutations.cancelEdit}
          onEditSave={mutations.submitEdit}
          recomputingIds={mutations.recomputingIds}
        />
      </div>

      <DeleteConfirmationDialog
        open={mutations.isDeleteDialogOpen}
        onOpenChange={(open) => { if (!open) mutations.cancelDelete(); }}
        transaction={mutations.deleteTarget}
        preview={mutations.deletePreview}
        isLoading={mutations.isDeletePreviewLoading}
        onConfirm={mutations.confirmDelete}
        dict={dict}
        locale={locale}
      />
      <EditConfirmationDialog
        open={mutations.isEditPreviewOpen}
        onOpenChange={(open) => { if (!open) mutations.cancelEditPreview(); }}
        preview={mutations.editPreview}
        isLoading={mutations.isEditPreviewLoading}
        dict={dict}
        locale={locale}
      />
      <FeeRecalcConfirmDialog
        open={mutations.isFeeConfirmOpen}
        onOpenChange={(open) => { if (!open) mutations.cancelEdit(); }}
        onRecalculate={mutations.confirmFeeRecalc}
        onKeepManual={mutations.keepManualFees}
        dict={dict}
      />

      <StatusToast message={mutations.message} variant="success" testId="mutation-status" />
      <StatusToast message={mutations.errorMessage} variant="error" testId="mutation-error" />
    </>
  );
}
