"use client";

import { useRouter } from "next/navigation";
import type { LocaleCode, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { DeleteConfirmationDialog } from "../../../components/portfolio/DeleteConfirmationDialog";
import { FeeRecalcConfirmDialog } from "../../../components/portfolio/FeeRecalcConfirmDialog";
import { useTransactionMutations } from "../../../features/portfolio/hooks/useTransactionMutations";

interface SymbolHistoryClientProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
}

export function SymbolHistoryClient({ transactions, dict, locale }: SymbolHistoryClientProps) {
  const router = useRouter();
  const mutations = useTransactionMutations({
    locale,
    dict,
    refresh: async () => {
      router.refresh();
    },
  });

  return (
    <>
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
      <FeeRecalcConfirmDialog
        open={mutations.isFeeConfirmOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelEdit();
        }}
        onRecalculate={mutations.confirmFeeRecalc}
        onKeepManual={mutations.keepManualFees}
        dict={dict}
      />
      {mutations.message && (
        <p
          data-testid="mutation-status"
          role="status"
          aria-live="polite"
          className="mt-4 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
        >
          {mutations.message}
        </p>
      )}
      {mutations.errorMessage && (
        <p
          data-testid="mutation-error"
          role="status"
          aria-live="polite"
          className="mt-4 rounded-[22px] border border-[rgba(251,113,133,0.28)] bg-[rgba(254,226,226,0.9)] px-4 py-3 text-sm text-rose-700"
        >
          {mutations.errorMessage}
        </p>
      )}
    </>
  );
}
