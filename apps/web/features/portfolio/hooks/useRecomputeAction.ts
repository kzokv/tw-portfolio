"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  LocaleCode,
  RecomputeFeeMode,
  RecomputePreviewDto,
} from "@vakwen/shared-types";
import { ApiError } from "../../../lib/api";
import { formatRecomputeMessage } from "../../../lib/i18n";
import { resolveErrorMessage } from "../../../lib/utils";
import { confirmRecompute, previewRecompute } from "../services/portfolioService";

interface UseRecomputeActionOptions {
  locale: LocaleCode;
  refresh: () => Promise<void>;
  previewRefreshedMessage?: string;
}

const REFRESHABLE_RECOMPUTE_PREVIEW_CODES = new Set([
  "recompute_preview_expired",
  "recompute_preview_drift",
  "recompute_preview_stale",
  "recompute_preview_fingerprint_mismatch",
]);

export function useRecomputeAction({
  locale,
  refresh,
  previewRefreshedMessage = locale === "zh-TW"
    ? "預覽已重新整理，請再次確認。"
    : "The preview was refreshed. Review it and confirm again.",
}: UseRecomputeActionOptions) {
  const [feeMode, setFeeModeState] = useState<RecomputeFeeMode>("KEEP_RECORDED");
  const [preview, setPreview] = useState<RecomputePreviewDto | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const reset = useCallback(() => {
    setFeeModeState("KEEP_RECORDED");
    setPreview(null);
    setIsPreviewLoading(false);
    setIsConfirming(false);
    setMessage("");
    setErrorMessage("");
  }, []);

  const setFeeMode = useCallback((mode: RecomputeFeeMode) => {
    setFeeModeState(mode);
    setPreview(null);
    setMessage("");
    setErrorMessage("");
  }, []);

  const requestPreview = useCallback(async (): Promise<RecomputePreviewDto | null> => {
    setIsPreviewLoading(true);
    setMessage("");
    setErrorMessage("");
    try {
      const nextPreview = await previewRecompute(feeMode);
      setPreview(nextPreview);
      return nextPreview;
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
      return null;
    } finally {
      setIsPreviewLoading(false);
    }
  }, [feeMode]);

  const confirmPreview = useCallback(async (): Promise<boolean> => {
    if (!preview || isConfirming) return false;
    setIsConfirming(true);
    setMessage("");
    setErrorMessage("");
    try {
      const confirmed = await confirmRecompute({
        jobId: preview.jobId,
        fingerprint: preview.fingerprint,
      });
      setPreview(null);
      setMessage(formatRecomputeMessage(locale, confirmed.status, confirmed.counts.total));
      try {
        await refresh();
      } catch (refreshError) {
        setErrorMessage(resolveErrorMessage(refreshError));
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code && REFRESHABLE_RECOMPUTE_PREVIEW_CODES.has(error.code)) {
        setPreview(null);
        try {
          const refreshedPreview = await previewRecompute(feeMode);
          setPreview(refreshedPreview);
          setMessage(previewRefreshedMessage);
          setErrorMessage("");
        } catch (refreshError) {
          setErrorMessage(resolveErrorMessage(refreshError));
        }
      } else {
        setErrorMessage(resolveErrorMessage(error));
      }
      return false;
    } finally {
      setIsConfirming(false);
    }
  }, [feeMode, isConfirming, locale, preview, previewRefreshedMessage, refresh]);

  const isRunning = useMemo(
    () => isPreviewLoading || isConfirming,
    [isConfirming, isPreviewLoading],
  );

  return {
    feeMode,
    setFeeMode,
    preview,
    isPreviewLoading,
    isConfirming,
    isRunning,
    message,
    setMessage,
    errorMessage,
    setErrorMessage,
    requestPreview,
    confirmPreview,
    reset,
  };
}
