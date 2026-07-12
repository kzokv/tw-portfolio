"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocaleCode,
  TransactionHistoryItemDto,
  PreviewImpactResponse,
  RecomputeCompleteEvent,
  RecomputeFailedEvent,
  SnapshotsGeneratedEvent,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { buildRouteDtoCacheTag, clearRouteDtoCacheByTags } from "../../../lib/routeDtoCache";
import { useEventStream } from "../../../hooks/useEventStream";
import {
  previewImpact,
  previewDividendDelete,
  deleteTransaction,
  patchTransaction,
  type DividendDeletePreviewResponse,
} from "../services/transactionMutationService";

export interface TransactionPatch {
  date?: string;
  quantity?: number;
  price?: number;
  side?: "BUY" | "SELL";
  commissionAmount?: number;
  taxAmount?: number;
  confirmFeeRecalculation?: boolean;
  keepManualFees?: boolean;
}

interface UseTransactionMutationsOptions {
  locale: LocaleCode;
  dict: AppDictionary;
  refresh: () => Promise<void>;
  onSnapshotsGenerated?: (event: SnapshotsGeneratedEvent) => void;
  onDeleteAccepted?: (transactionId: string) => void;
}

export interface UseTransactionMutationsResult {
  // Delete flow
  deleteTarget: TransactionHistoryItemDto | null;
  deletePreview: PreviewImpactResponse | null;
  deleteDividendPreview: DividendDeletePreviewResponse | null;
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

  // Edit preview (negative lots block)
  editPreview: PreviewImpactResponse | null;
  isEditPreviewOpen: boolean;
  isEditPreviewLoading: boolean;
  cancelEditPreview: () => void;

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

const SAFETY_NET_MS = 10_000;
export const MUTATION_ROUTE_CACHE_TAGS = [
  buildRouteDtoCacheTag("route", "dashboard-primary"),
  buildRouteDtoCacheTag("route", "dashboard-performance"),
  buildRouteDtoCacheTag("route", "analysis-unrealized-pnl"),
  buildRouteDtoCacheTag("route", "portfolio-primary"),
  buildRouteDtoCacheTag("route", "reports"),
  buildRouteDtoCacheTag("route", "transactions-primary"),
];

export function useTransactionMutations({
  dict,
  refresh,
  onSnapshotsGenerated,
  onDeleteAccepted,
}: UseTransactionMutationsOptions): UseTransactionMutationsResult {
  // Delete flow state
  const [deleteTarget, setDeleteTarget] = useState<TransactionHistoryItemDto | null>(null);
  const [deletePreview, setDeletePreview] = useState<PreviewImpactResponse | null>(null);
  const [deleteDividendPreview, setDeleteDividendPreview] = useState<DividendDeletePreviewResponse | null>(null);
  const [isDeletePreviewLoading, setIsDeletePreviewLoading] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Edit flow state
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit preview state (negative lots confirmation before PATCH)
  const [editPreview, setEditPreview] = useState<PreviewImpactResponse | null>(null);
  const [isEditPreviewOpen, setIsEditPreviewOpen] = useState(false);
  const [isEditPreviewLoading, setIsEditPreviewLoading] = useState(false);

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
  const onSnapshotsGeneratedRef = useRef(onSnapshotsGenerated);
  onSnapshotsGeneratedRef.current = onSnapshotsGenerated;
  const onDeleteAcceptedRef = useRef(onDeleteAccepted);
  onDeleteAcceptedRef.current = onDeleteAccepted;
  const recomputingSymbolsRef = useRef(recomputingSymbols);
  recomputingSymbolsRef.current = recomputingSymbols;

  const sseDeliveredRef = useRef(false);
  const safetyNetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper: add recomputing state
  const addRecomputing = useCallback((transactionId: string, accountId: string, ticker: string) => {
    clearRouteDtoCacheByTags(MUTATION_ROUTE_CACHE_TAGS);
    setRecomputingIds((prev) => new Set([...prev, transactionId]));
    setRecomputingSymbols((prev) => new Set([...prev, `${accountId}:${ticker}`]));
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

  const refreshAndReportSuccess = useCallback((successMessage: string) => {
    void refreshRef.current()
      .then(() => {
        setMessage(successMessage);
        setErrorMessage("");
      })
      .catch((err: unknown) => {
        setMessage("");
        setErrorMessage(err instanceof Error ? err.message : "Refresh failed");
      });
  }, []);

  // Disable guard — check if symbol is recomputing
  const isSymbolRecomputing = useCallback(
    (accountId: string, ticker: string) => recomputingSymbols.has(`${accountId}:${ticker}`),
    [recomputingSymbols],
  );

  // --- Delete flow ---
  const startDelete = useCallback(
    (transaction: TransactionHistoryItemDto) => {
      if (isSymbolRecomputing(transaction.accountId, transaction.ticker)) return;
      setDeleteTarget(transaction);
      setDeletePreview(null);
      setDeleteDividendPreview(null);
      setIsDeletePreviewLoading(true);
      setIsDeleteDialogOpen(true);
      setMessage("");
      setErrorMessage("");

      previewImpact(transaction.id, "delete")
        .then(async (impactPreview) => {
          setDeletePreview(impactPreview);
          if (impactPreview.negativeLots.wouldOccur) {
            setIsDeletePreviewLoading(false);
            return;
          }

          const dividendPreview = await previewDividendDelete(transaction.id);
          setDeleteDividendPreview(dividendPreview);
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
    setDeleteDividendPreview(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || !deleteDividendPreview) return;
    setMessage("");
    setErrorMessage("");

    try {
      await deleteTransaction(deleteTarget.id, {
        previewId: deleteDividendPreview.preview.previewId,
        previewVersion: deleteDividendPreview.preview.previewVersion,
        fingerprint: deleteDividendPreview.preview.fingerprint,
      });
      onDeleteAcceptedRef.current?.(deleteTarget.id);
      addRecomputing(deleteTarget.id, deleteTarget.accountId, deleteTarget.ticker);
      setEditingId(null);
      setIsDeleteDialogOpen(false);
      setMessage(dictRef.current.mutations.deleteSuccessMessage);
      setDeleteTarget(null);
      setDeletePreview(null);
      setDeleteDividendPreview(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Delete failed");
    }
  }, [deleteDividendPreview, deleteTarget, addRecomputing]);

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

  // Internal: execute the PATCH (called after preview check passes or user confirms)
  const executePatch = useCallback(
    async (transactionId: string, patch: TransactionPatch) => {
      try {
        const patchBody: Record<string, unknown> = {};
        if (patch.date !== undefined) patchBody.date = patch.date;
        if (patch.quantity !== undefined) patchBody.quantity = patch.quantity;
        if (patch.price !== undefined) patchBody.price = patch.price;
        if (patch.side !== undefined) patchBody.side = patch.side;
        if (patch.commissionAmount !== undefined) patchBody.commissionAmount = patch.commissionAmount;
        if (patch.taxAmount !== undefined) patchBody.taxAmount = patch.taxAmount;
        if (patch.confirmFeeRecalculation) patchBody.confirmFeeRecalculation = true;
        if (patch.keepManualFees) patchBody.keepManualFees = true;

        const result = await patchTransaction(transactionId, patchBody);

        if ("requiresFeeConfirmation" in result && result.requiresFeeConfirmation) {
          setFeeConfirmTarget({ transactionId, patch });
          return;
        }

        // Success — result is PatchTransactionResponse
        const patchResult = result as { accountId: string; ticker: string };
        setMessage(dictRef.current.mutations.editSuccessMessage);
        setEditingId(null);
        addRecomputing(transactionId, patchResult.accountId, patchResult.ticker);
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : "Edit failed");
      }
    },
    [addRecomputing],
  );

  const submitEdit = useCallback(
    async (transactionId: string, patch: TransactionPatch) => {
      // If side or quantity changed, preview for negative lots before patching
      if (patch.side !== undefined || patch.quantity !== undefined) {
        setIsEditPreviewLoading(true);
        setIsEditPreviewOpen(true);
        setEditPreview(null);
        setMessage("");
        setErrorMessage("");

        try {
          const preview = await previewImpact(transactionId, "patch", {
            side: patch.side,
            quantity: patch.quantity,
            price: patch.price,
            date: patch.date,
          });
          setEditPreview(preview);
          setIsEditPreviewLoading(false);

          // No negative lots — proceed directly without showing dialog
          if (!preview.negativeLots.wouldOccur) {
            setIsEditPreviewOpen(false);
            await executePatch(transactionId, patch);
            return;
          }
          // Negative lots — dialog stays open (hard-blocked, cancel only)
        } catch (err: Error | unknown) {
          setIsEditPreviewLoading(false);
          setIsEditPreviewOpen(false);
          setErrorMessage(err instanceof Error ? err.message : "Preview failed");
        }
        return;
      }

      // No side/quantity change — patch directly (date/price-only edits)
      await executePatch(transactionId, patch);
    },
    [executePatch],
  );

  const cancelEditPreview = useCallback(() => {
    setIsEditPreviewOpen(false);
    setEditPreview(null);
    setEditingId(null); // Exit edit mode entirely when negative lots block is dismissed
  }, []);

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
      const markMutationEventDelivered = () => {
        sseDeliveredRef.current = true;
        if (safetyNetTimerRef.current !== null) {
          clearTimeout(safetyNetTimerRef.current);
          safetyNetTimerRef.current = null;
        }
      };

      const event = data as RecomputeCompleteEvent | RecomputeFailedEvent | SnapshotsGeneratedEvent;

      if (event.type === "snapshots_generated") {
        clearRouteDtoCacheByTags(MUTATION_ROUTE_CACHE_TAGS);
        onSnapshotsGeneratedRef.current?.(event);
        const matchedScopeKeys = event.trigger === "dividend_destructive_replay"
          ? (event.scopes ?? [])
            .map((scope) => `${scope.accountId}:${scope.ticker}`)
            .filter((key) => recomputingSymbolsRef.current.has(key))
          : [];
        if (matchedScopeKeys.length > 0) {
          markMutationEventDelivered();
          for (const key of matchedScopeKeys) removeRecomputingBySymbol(key);
          if (event.status === "ok") {
            refreshAndReportSuccess(dictRef.current.mutations.recomputeCompleteMessage);
          } else {
            setMessage("");
            setErrorMessage(event.error ?? dictRef.current.mutations.recomputeExhaustedMessage);
          }
        }
        return;
      }

      const recomputeEvent = event as RecomputeCompleteEvent | RecomputeFailedEvent;
      const key = `${recomputeEvent.accountId}:${recomputeEvent.ticker}`;
      if (!recomputingSymbolsRef.current.has(key)) return;
      markMutationEventDelivered();

      if (recomputeEvent.type === "recompute_complete") {
        removeRecomputingBySymbol(key);
        refreshAndReportSuccess(dictRef.current.mutations.recomputeCompleteMessage);
      }

      if (recomputeEvent.type === "recompute_failed") {
        if (!recomputeEvent.retriesExhausted) {
          setMessage(dictRef.current.mutations.recomputeRetryMessage);
        } else {
          removeRecomputingBySymbol(key);
          setErrorMessage(dictRef.current.mutations.recomputeExhaustedMessage);
          setMessage("");
        }
      }
    },
    [refreshAndReportSuccess, removeRecomputingBySymbol],
  );

  useEventStream({
    eventTypes: ["recompute_complete", "recompute_failed", "snapshots_generated"],
    onEvent: handleSSEEvent,
    enabled: true,
  });

  // --- Safety net timer ---
  // If SSE delivers nothing within SAFETY_NET_MS, assume the event was lost or
  // SSE is disconnected. Refresh data, clear loading, show neutral message.
  useEffect(() => {
    if (recomputingSymbols.size === 0) return;

    sseDeliveredRef.current = false;
    safetyNetTimerRef.current = setTimeout(() => {
      if (sseDeliveredRef.current) return; // Defensive: SSE already handled
      console.warn("[useTransactionMutations] SSE silent for recompute — safety net fired", {
        symbols: [...recomputingSymbols],
      });
      clearAllRecomputing();
      refreshAndReportSuccess(dictRef.current.mutations.safetyNetMessage);
    }, SAFETY_NET_MS);

    return () => {
      if (safetyNetTimerRef.current !== null) {
        clearTimeout(safetyNetTimerRef.current);
        safetyNetTimerRef.current = null;
      }
    };
  }, [recomputingSymbolsKey, clearAllRecomputing, refreshAndReportSuccess]);

  return {
    deleteTarget,
    deletePreview,
    deleteDividendPreview,
    isDeletePreviewLoading,
    isDeleteDialogOpen,
    startDelete,
    confirmDelete,
    cancelDelete,
    editingId,
    startEdit,
    cancelEdit,
    submitEdit,
    editPreview,
    isEditPreviewOpen,
    isEditPreviewLoading,
    cancelEditPreview,
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
