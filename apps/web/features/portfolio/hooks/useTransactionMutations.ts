"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocaleCode,
  TransactionHistoryItemDto,
  PreviewImpactResponse,
  RecomputeCompleteEvent,
  RecomputeFailedEvent,
} from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { useEventStream } from "../../../hooks/useEventStream";
import {
  previewImpact,
  deleteTransaction,
  patchTransaction,
} from "../services/transactionMutationService";

export interface TransactionPatch {
  date?: string;
  quantity?: number;
  price?: number;
  side?: "BUY" | "SELL";
  confirmFeeRecalculation?: boolean;
  keepManualFees?: boolean;
}

interface UseTransactionMutationsOptions {
  locale: LocaleCode;
  dict: AppDictionary;
  refresh: () => Promise<void>;
}

export interface UseTransactionMutationsResult {
  // Delete flow
  deleteTarget: TransactionHistoryItemDto | null;
  deletePreview: PreviewImpactResponse | null;
  isDeletePreviewLoading: boolean;
  isDeleteDialogOpen: boolean;
  startDelete: (transaction: TransactionHistoryItemDto) => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;

  // Edit flow
  editingId: string | null;
  startEdit: (id: string) => void;
  cancelEdit: () => void;
  submitEdit: (transactionId: string, patch: TransactionPatch) => Promise<void>;

  // Fee confirmation
  feeConfirmTarget: { transactionId: string; patch: TransactionPatch } | null;
  isFeeConfirmOpen: boolean;
  confirmFeeRecalc: () => Promise<void>;
  keepManualFees: () => Promise<void>;

  // Loading state
  recomputingIds: Set<string>;
  recomputingSymbols: Set<string>;

  // Feedback
  message: string;
  errorMessage: string;
  setMessage: (msg: string) => void;
  setErrorMessage: (msg: string) => void;
}

const TIMEOUT_MS = parseInt(
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_RECOMPUTE_TIMEOUT_MS || "30000"
    : "30000",
  10,
);

export function useTransactionMutations({
  dict,
  refresh,
}: UseTransactionMutationsOptions): UseTransactionMutationsResult {
  // Delete flow state
  const [deleteTarget, setDeleteTarget] = useState<TransactionHistoryItemDto | null>(null);
  const [deletePreview, setDeletePreview] = useState<PreviewImpactResponse | null>(null);
  const [isDeletePreviewLoading, setIsDeletePreviewLoading] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Edit flow state
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fee confirmation state
  const [feeConfirmTarget, setFeeConfirmTarget] = useState<{ transactionId: string; patch: TransactionPatch } | null>(null);

  // Loading state: track recomputing transaction IDs and account:symbol pairs
  const [recomputingIds, setRecomputingIds] = useState<Set<string>>(new Set());
  const [recomputingSymbols, setRecomputingSymbols] = useState<Set<string>>(new Set());

  // Feedback
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Stable ref for recomputingSymbols key (for timeout effect)
  const recomputingSymbolsKey = useMemo(
    () => JSON.stringify([...recomputingSymbols].sort()),
    [recomputingSymbols],
  );

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const dictRef = useRef(dict);
  dictRef.current = dict;

  // Helper: add recomputing state
  const addRecomputing = useCallback((transactionId: string, accountId: string, symbol: string) => {
    setRecomputingIds((prev) => new Set([...prev, transactionId]));
    setRecomputingSymbols((prev) => new Set([...prev, `${accountId}:${symbol}`]));
  }, []);

  // Helper: remove recomputing state by symbol key
  const removeRecomputingBySymbol = useCallback((key: string) => {
    setRecomputingSymbols((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    // Clear all IDs (simplified — in a real scenario we'd track id→key mapping)
    // Since recompute events include accountId+symbol, we clear IDs that could match
    setRecomputingIds(new Set());
  }, []);

  const clearAllRecomputing = useCallback(() => {
    setRecomputingIds(new Set());
    setRecomputingSymbols(new Set());
  }, []);

  // Disable guard — check if symbol is recomputing
  const isSymbolRecomputing = useCallback(
    (accountId: string, symbol: string) => recomputingSymbols.has(`${accountId}:${symbol}`),
    [recomputingSymbols],
  );

  // --- Delete flow ---
  const startDelete = useCallback(
    (transaction: TransactionHistoryItemDto) => {
      if (isSymbolRecomputing(transaction.accountId, transaction.symbol)) return;
      setDeleteTarget(transaction);
      setDeletePreview(null);
      setIsDeletePreviewLoading(true);
      setIsDeleteDialogOpen(true);
      setMessage("");
      setErrorMessage("");

      previewImpact(transaction.id, "delete")
        .then((preview) => {
          setDeletePreview(preview);
          setIsDeletePreviewLoading(false);
        })
        .catch((err: Error) => {
          setIsDeletePreviewLoading(false);
          setErrorMessage(err.message);
          setIsDeleteDialogOpen(false);
        });
    },
    [isSymbolRecomputing],
  );

  const cancelDelete = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setDeleteTarget(null);
    setDeletePreview(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleteDialogOpen(false);
    setMessage(dictRef.current.mutations.deleteSuccessMessage);

    try {
      const result = await deleteTransaction(deleteTarget.id);
      addRecomputing(deleteTarget.id, result.accountId, result.symbol);
      setEditingId(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Delete failed");
      setMessage("");
    }
    setDeleteTarget(null);
    setDeletePreview(null);
  }, [deleteTarget, addRecomputing]);

  // --- Edit flow ---
  const startEdit = useCallback(
    (id: string) => {
      // We don't have the full transaction here, but the caller can check
      // recomputingIds before calling. This is a simpler guard.
      setEditingId(id);
      setMessage("");
      setErrorMessage("");
    },
    [],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setFeeConfirmTarget(null);
  }, []);

  const submitEdit = useCallback(
    async (transactionId: string, patch: TransactionPatch) => {
      try {
        const patchBody: Record<string, unknown> = {};
        if (patch.date !== undefined) patchBody.date = patch.date;
        if (patch.quantity !== undefined) patchBody.quantity = patch.quantity;
        if (patch.price !== undefined) patchBody.price = patch.price;
        if (patch.side !== undefined) patchBody.side = patch.side;
        if (patch.confirmFeeRecalculation) patchBody.confirmFeeRecalculation = true;
        if (patch.keepManualFees) patchBody.keepManualFees = true;

        const result = await patchTransaction(transactionId, patchBody);

        if ("requiresFeeConfirmation" in result && result.requiresFeeConfirmation) {
          setFeeConfirmTarget({ transactionId, patch });
          return;
        }

        // Success — result is PatchTransactionResponse
        const patchResult = result as { accountId: string; symbol: string };
        setMessage(dictRef.current.mutations.editSuccessMessage);
        setEditingId(null);
        addRecomputing(transactionId, patchResult.accountId, patchResult.symbol);
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : "Edit failed");
      }
    },
    [addRecomputing],
  );

  // --- Fee confirmation ---
  const isFeeConfirmOpen = feeConfirmTarget !== null;

  const confirmFeeRecalc = useCallback(async () => {
    if (!feeConfirmTarget) return;
    const { transactionId, patch } = feeConfirmTarget;
    setFeeConfirmTarget(null);
    await submitEdit(transactionId, { ...patch, confirmFeeRecalculation: true });
  }, [feeConfirmTarget, submitEdit]);

  const keepManualFees = useCallback(async () => {
    if (!feeConfirmTarget) return;
    const { transactionId, patch } = feeConfirmTarget;
    setFeeConfirmTarget(null);
    await submitEdit(transactionId, { ...patch, keepManualFees: true });
  }, [feeConfirmTarget, submitEdit]);

  // --- SSE integration ---
  const handleSSEEvent = useCallback(
    (data: unknown) => {
      const event = data as RecomputeCompleteEvent | RecomputeFailedEvent;
      const key = `${event.accountId}:${event.symbol}`;

      if (event.type === "recompute_complete") {
        removeRecomputingBySymbol(key);
        setMessage(dictRef.current.mutations.recomputeCompleteMessage);
        setErrorMessage("");
        void refreshRef.current();
      }

      if (event.type === "recompute_failed") {
        if (!event.retriesExhausted) {
          setMessage(dictRef.current.mutations.recomputeRetryMessage);
        } else {
          removeRecomputingBySymbol(key);
          setErrorMessage(dictRef.current.mutations.recomputeExhaustedMessage);
          setMessage("");
        }
      }
    },
    [removeRecomputingBySymbol],
  );

  useEventStream({
    eventTypes: ["recompute_complete", "recompute_failed"],
    onEvent: handleSSEEvent,
    enabled: true,
  });

  // --- Timeout ---
  useEffect(() => {
    if (recomputingSymbols.size === 0) return;
    const timer = setTimeout(() => {
      clearAllRecomputing();
      setMessage(dictRef.current.mutations.recomputeTimeoutMessage);
      void refreshRef.current();
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [recomputingSymbolsKey, clearAllRecomputing]);

  return {
    deleteTarget,
    deletePreview,
    isDeletePreviewLoading,
    isDeleteDialogOpen,
    startDelete,
    confirmDelete,
    cancelDelete,
    editingId,
    startEdit,
    cancelEdit,
    submitEdit,
    feeConfirmTarget,
    isFeeConfirmOpen,
    confirmFeeRecalc,
    keepManualFees,
    recomputingIds,
    recomputingSymbols,
    message,
    errorMessage,
    setMessage,
    setErrorMessage,
  };
}
