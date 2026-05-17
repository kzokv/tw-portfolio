"use client";

import { useCallback, useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import { formatRecomputeMessage } from "../../../lib/i18n";
import { resolveErrorMessage } from "../../../lib/utils";
import { confirmRecompute, previewRecompute } from "../services/portfolioService";

interface UseRecomputeActionOptions {
  locale: LocaleCode;
  fallbackConfirm: string;
  refresh: () => Promise<void>;
}

interface RunRecomputeOptions {
  /**
   * Skip the in-hook `window.confirm` prompt. Callers that have already
   * confirmed via their own UI (e.g. the ⌘K AlertDialog per spec §12 A2)
   * pass `true` so the user only sees one confirmation. Default `false`
   * preserves the pre-Phase-3e legacy behavior.
   */
  skipConfirm?: boolean;
}

export function useRecomputeAction({ locale, fallbackConfirm, refresh }: UseRecomputeActionOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const runRecompute = useCallback(
    async (options: RunRecomputeOptions = {}) => {
      if (!options.skipConfirm) {
        const proceed = window.confirm(fallbackConfirm);
        if (!proceed) {
          return;
        }
      }

      setIsRunning(true);
      setErrorMessage("");

      try {
        const preview = await previewRecompute();
        const confirmed = await confirmRecompute(preview.id);

        setMessage(formatRecomputeMessage(locale, confirmed.status, preview.items.length));
        await refresh();
      } catch (error) {
        setErrorMessage(resolveErrorMessage(error));
      } finally {
        setIsRunning(false);
      }
    },
    [fallbackConfirm, locale, refresh],
  );

  return {
    isRunning,
    message,
    setMessage,
    errorMessage,
    setErrorMessage,
    runRecompute,
  };
}
