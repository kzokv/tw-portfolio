"use client";

import { useCallback, useState } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { formatRecomputeMessage } from "../../../lib/i18n";
import { confirmRecompute, previewRecompute } from "../services/portfolioService";

interface UseRecomputeActionOptions {
  locale: LocaleCode;
  fallbackConfirm: string;
  refresh: () => Promise<void>;
}

export function useRecomputeAction({ locale, fallbackConfirm, refresh }: UseRecomputeActionOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const runRecompute = useCallback(async () => {
    const proceed = window.confirm(fallbackConfirm);
    if (!proceed) {
      return;
    }

    setIsRunning(true);
    setErrorMessage("");

    try {
      const preview = await previewRecompute();
      const confirmed = await confirmRecompute(preview.id);

      setMessage(formatRecomputeMessage(locale, confirmed.status, preview.items.length));
      await refresh();
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setIsRunning(false);
    }
  }, [fallbackConfirm, locale, refresh]);

  return {
    isRunning,
    message,
    setMessage,
    errorMessage,
    setErrorMessage,
    runRecompute,
  };
}
