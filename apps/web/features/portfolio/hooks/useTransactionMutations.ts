"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocaleCode,
  PostedTransactionMutationPreviewDto,
  PostedTransactionMutationRunDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { ApiError } from "../../../lib/api";
import { clearRouteDtoCacheByTags, buildRouteDtoCacheTag } from "../../../lib/routeDtoCache";
import {
  confirmPostedTransactionMutation,
  getPostedTransactionMutationRun,
  previewPostedTransactionDeleteBatch,
  previewPostedTransactionUpdateBatch,
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
  onDeleteAccepted?: (transactionId: string) => void;
}

interface PendingEditRequest {
  patch: TransactionPatch;
  transactionId: string;
}

export interface UseTransactionMutationsResult {
  deleteTarget: TransactionHistoryItemDto | null;
  deletePreview: PostedTransactionMutationPreviewDto | null;
  deleteDividendPreview: null;
  isDeletePreviewLoading: boolean;
  isDeleteSubmitting: boolean;
  isDeleteDialogOpen: boolean;
  startDelete: (transaction: TransactionHistoryItemDto) => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
  editingId: string | null;
  startEdit: (id: string) => void;
  cancelEdit: () => void;
  submitEdit: (transactionId: string, patch: TransactionPatch) => Promise<void>;
  editPreview: PostedTransactionMutationPreviewDto | null;
  isEditPreviewOpen: boolean;
  isEditPreviewLoading: boolean;
  isEditSubmitting: boolean;
  confirmEdit: () => Promise<void>;
  cancelEditPreview: () => void;
  feeConfirmTarget: null;
  isFeeConfirmOpen: boolean;
  confirmFeeRecalc: () => Promise<void>;
  keepManualFees: () => Promise<void>;
  recomputingIds: Set<string>;
  recomputingSymbols: Set<string>;
  message: string;
  errorMessage: string;
  setMessage: (msg: string) => void;
  setErrorMessage: (msg: string) => void;
}

const RUN_POLL_MS = 1_500;
const TERMINAL_REBUILD_STATUSES = new Set(["completed", "partially_failed", "failed"]);
const DELETE_MUTATION_REASON = "User requested a posted transaction deletion from ticker history.";
const REFRESHABLE_MUTATION_PREVIEW_CODES = new Set([
  "posted_transaction_mutation_preview_expired",
  "posted_transaction_mutation_preview_stale",
]);
export const MUTATION_ROUTE_CACHE_TAGS = [
  buildRouteDtoCacheTag("route", "dashboard-primary"),
  buildRouteDtoCacheTag("route", "dashboard-performance"),
  buildRouteDtoCacheTag("route", "analysis-unrealized-pnl"),
  buildRouteDtoCacheTag("route", "portfolio-primary"),
  buildRouteDtoCacheTag("route", "reports"),
  buildRouteDtoCacheTag("route", "transactions-primary"),
];

function extractRunError(run: PostedTransactionMutationRunDto, fallback: string): string {
  if (run.errors[0]?.message) return run.errors[0].message;
  if (run.blockers[0]) return run.blockers[0];
  if (run.warnings[0] && run.rebuildStatus === "partially_failed") return run.warnings[0];
  return fallback;
}

function toUpdatePatch(patch: TransactionPatch) {
  return {
    tradeDate: patch.date,
    quantity: patch.quantity,
    unitPrice: patch.price,
    side: patch.side,
    commissionAmount: patch.commissionAmount,
    taxAmount: patch.taxAmount,
    feeOverrideMode: patch.confirmFeeRecalculation
      ? "recalculate"
      : "preserve_recorded",
  } as const;
}

export function useTransactionMutations({
  locale: _locale,
  dict,
  refresh,
  onDeleteAccepted,
}: UseTransactionMutationsOptions): UseTransactionMutationsResult {
  const [deleteTarget, setDeleteTarget] = useState<TransactionHistoryItemDto | null>(null);
  const [deletePreview, setDeletePreview] = useState<PostedTransactionMutationPreviewDto | null>(null);
  const [isDeletePreviewLoading, setIsDeletePreviewLoading] = useState(false);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingEditRequest, setPendingEditRequest] = useState<PendingEditRequest | null>(null);
  const [editPreview, setEditPreview] = useState<PostedTransactionMutationPreviewDto | null>(null);
  const [isEditPreviewOpen, setIsEditPreviewOpen] = useState(false);
  const [isEditPreviewLoading, setIsEditPreviewLoading] = useState(false);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  const [recomputingIds, setRecomputingIds] = useState<Set<string>>(new Set());
  const [recomputingSymbols, setRecomputingSymbols] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const dictRef = useRef(dict);
  dictRef.current = dict;
  const pollTimersRef = useRef<Map<string, number>>(new Map());
  const recomputingSymbolsKey = useMemo(() => JSON.stringify([...recomputingSymbols].sort()), [recomputingSymbols]);

  const addRecomputing = useCallback((transactionId: string, accountId: string, ticker: string) => {
    clearRouteDtoCacheByTags(MUTATION_ROUTE_CACHE_TAGS);
    setRecomputingIds((prev) => new Set(prev).add(transactionId));
    setRecomputingSymbols((prev) => new Set(prev).add(`${accountId}:${ticker}`));
  }, []);

  const removeRecomputing = useCallback((transactionId: string, accountId: string, ticker: string) => {
    setRecomputingIds((prev) => {
      const next = new Set(prev);
      next.delete(transactionId);
      return next;
    });
    setRecomputingSymbols((prev) => {
      const next = new Set(prev);
      next.delete(`${accountId}:${ticker}`);
      return next;
    });
  }, []);

  const finishRun = useCallback(async (
    run: PostedTransactionMutationRunDto,
    transactionId: string,
    accountId: string,
    ticker: string,
  ) => {
    if (!TERMINAL_REBUILD_STATUSES.has(run.rebuildStatus)) return false;
    removeRecomputing(transactionId, accountId, ticker);
    if (run.rebuildStatus === "completed" && run.status !== "failed") {
      await refreshRef.current();
      setMessage(dictRef.current.mutations.recomputeCompleteMessage);
      setErrorMessage("");
      return true;
    }
    setMessage("");
    setErrorMessage(extractRunError(run, dictRef.current.mutations.recomputeExhaustedMessage));
    return true;
  }, [removeRecomputing]);

  const pollRun = useCallback(async (
    runId: string,
    transactionId: string,
    accountId: string,
    ticker: string,
  ) => {
    const current = await getPostedTransactionMutationRun(runId);
    const done = await finishRun(current, transactionId, accountId, ticker);
    if (done) return;
    setMessage(dictRef.current.mutations.recomputeRetryMessage);
    const timer = window.setTimeout(() => {
      void pollRun(runId, transactionId, accountId, ticker);
    }, RUN_POLL_MS);
    pollTimersRef.current.set(runId, timer);
  }, [finishRun]);

  const handleConfirmedRun = useCallback(async (
    run: PostedTransactionMutationRunDto,
    transactionId: string,
    accountId: string,
    ticker: string,
  ) => {
    addRecomputing(transactionId, accountId, ticker);
    if (await finishRun(run, transactionId, accountId, ticker)) return;
    setMessage(run.rebuildStatus === "running" ? dictRef.current.mutations.recomputeRetryMessage : dictRef.current.mutations.safetyNetMessage);
    setErrorMessage("");
    void pollRun(run.runId, transactionId, accountId, ticker);
  }, [addRecomputing, finishRun, pollRun]);

  const resetDeleteState = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setDeleteTarget(null);
    setDeletePreview(null);
    setIsDeletePreviewLoading(false);
    setIsDeleteSubmitting(false);
  }, []);

  const startDelete = useCallback((transaction: TransactionHistoryItemDto) => {
    setDeleteTarget(transaction);
    setDeletePreview(null);
    setIsDeletePreviewLoading(true);
    setIsDeleteDialogOpen(true);
    setMessage("");
    setErrorMessage("");
    void previewPostedTransactionDeleteBatch(
      DELETE_MUTATION_REASON,
      [{ transactionId: transaction.id }],
    ).then((preview) => {
      setDeletePreview(preview);
      setIsDeletePreviewLoading(false);
    }).catch((err: unknown) => {
      setIsDeletePreviewLoading(false);
      setErrorMessage(err instanceof Error ? err.message : "Delete preview failed");
      setIsDeleteDialogOpen(false);
    });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || !deletePreview || isDeleteSubmitting) return;
    setIsDeleteSubmitting(true);
    setMessage("");
    setErrorMessage("");
    try {
      const run = await confirmPostedTransactionMutation(deletePreview.previewId, {
        previewVersion: deletePreview.previewVersion,
        operation: deletePreview.operation,
        fingerprint: deletePreview.fingerprint,
        confirmationSummary: deletePreview.confirmationSummary,
        confirmationDigest: deletePreview.confirmationDigest,
      });
      onDeleteAccepted?.(deleteTarget.id);
      resetDeleteState();
      setEditingId(null);
      setMessage(dictRef.current.mutations.deleteSuccessMessage);
      await handleConfirmedRun(run, deleteTarget.id, deleteTarget.accountId, deleteTarget.ticker);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code && REFRESHABLE_MUTATION_PREVIEW_CODES.has(err.code)) {
        setIsDeletePreviewLoading(true);
        try {
          const refreshedPreview = await previewPostedTransactionDeleteBatch(
            DELETE_MUTATION_REASON,
            [{ transactionId: deleteTarget.id }],
          );
          setDeletePreview(refreshedPreview);
          setMessage(dictRef.current.mutations.deletePreviewRefreshed);
          setErrorMessage("");
        } catch (refreshError: unknown) {
          setErrorMessage(refreshError instanceof Error ? refreshError.message : "Delete preview refresh failed");
        } finally {
          setIsDeletePreviewLoading(false);
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Delete failed");
      }
    } finally {
      setIsDeleteSubmitting(false);
    }
  }, [deletePreview, deleteTarget, handleConfirmedRun, isDeleteSubmitting, onDeleteAccepted, resetDeleteState]);

  const cancelDelete = useCallback(() => {
    if (isDeleteSubmitting) return;
    resetDeleteState();
  }, [isDeleteSubmitting, resetDeleteState]);

  const startEdit = useCallback((id: string) => {
    setEditingId(id);
    setPendingEditRequest(null);
    setEditPreview(null);
    setIsEditPreviewOpen(false);
    setMessage("");
    setErrorMessage("");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setPendingEditRequest(null);
    setEditPreview(null);
    setIsEditPreviewOpen(false);
    setIsEditPreviewLoading(false);
  }, []);

  const submitEdit = useCallback(async (transactionId: string, patch: TransactionPatch) => {
    setPendingEditRequest({ transactionId, patch });
    setEditPreview(null);
    setIsEditPreviewLoading(true);
    setIsEditPreviewOpen(true);
    setMessage("");
    setErrorMessage("");
    try {
      const preview = await previewPostedTransactionUpdateBatch(
        "User confirmed a posted transaction update from ticker history.",
        [{ transactionId, patch: toUpdatePatch(patch) }],
      );
      setEditPreview(preview);
    } catch (err: unknown) {
      setIsEditPreviewOpen(false);
      setErrorMessage(err instanceof Error ? err.message : "Update preview failed");
    } finally {
      setIsEditPreviewLoading(false);
    }
  }, []);

  const confirmEdit = useCallback(async () => {
    if (!pendingEditRequest || !editPreview || isEditSubmitting) return;
    const transactionId = pendingEditRequest.transactionId;
    const item = editPreview.page.items.find((candidate) => candidate.transactionId === transactionId);
    const before = item?.before;
    if (!before) {
      setErrorMessage("Update preview did not include the requested transaction.");
      return;
    }
    setIsEditSubmitting(true);
    setMessage("");
    setErrorMessage("");
    try {
      const run = await confirmPostedTransactionMutation(editPreview.previewId, {
        previewVersion: editPreview.previewVersion,
        operation: editPreview.operation,
        fingerprint: editPreview.fingerprint,
        confirmationSummary: editPreview.confirmationSummary,
        confirmationDigest: editPreview.confirmationDigest,
      });
      setEditingId(null);
      setPendingEditRequest(null);
      setEditPreview(null);
      setIsEditPreviewOpen(false);
      setMessage(dictRef.current.mutations.editSuccessMessage);
      await handleConfirmedRun(run, transactionId, before.accountId, before.ticker);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setIsEditSubmitting(false);
    }
  }, [editPreview, handleConfirmedRun, isEditSubmitting, pendingEditRequest]);

  const cancelEditPreview = useCallback(() => {
    if (isEditSubmitting) return;
    setPendingEditRequest(null);
    setEditPreview(null);
    setIsEditPreviewOpen(false);
    setIsEditPreviewLoading(false);
    setEditingId(null);
  }, [isEditSubmitting]);

  useEffect(() => () => {
    for (const timer of pollTimersRef.current.values()) {
      clearTimeout(timer);
    }
    pollTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (recomputingSymbolsKey === "[]") return;
    clearRouteDtoCacheByTags(MUTATION_ROUTE_CACHE_TAGS);
  }, [recomputingSymbolsKey]);

  return {
    deleteTarget,
    deletePreview,
    deleteDividendPreview: null,
    isDeletePreviewLoading,
    isDeleteSubmitting,
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
    isEditSubmitting,
    confirmEdit,
    cancelEditPreview,
    feeConfirmTarget: null,
    isFeeConfirmOpen: false,
    confirmFeeRecalc: async () => {},
    keepManualFees: async () => {},
    recomputingIds,
    recomputingSymbols,
    message,
    errorMessage,
    setMessage,
    setErrorMessage,
  };
}
