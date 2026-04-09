"use client";

import { useCallback, useState } from "react";
import { ApiError } from "../../../lib/api";
import { resolveErrorMessage } from "../../../lib/utils";
import { submitDividendPosting } from "../services/dividendService";
import type { DividendPostingPayload, DividendPostingResult } from "../types";

interface UseDividendPostingOptions {
  versionConflictMessage: string;
  stockEditNotAllowedMessage: string;
}

export function useDividendPosting({
  versionConflictMessage,
  stockEditNotAllowedMessage,
}: UseDividendPostingOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const submit = useCallback(async (payload: DividendPostingPayload): Promise<DividendPostingResult | null> => {
    setIsSubmitting(true);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await submitDividendPosting(payload);
      setMessage("ok");
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "dividend_version_conflict") {
          setErrorMessage(versionConflictMessage);
          return null;
        }
        if (error.code === "stock_dividend_in_place_edit_unsupported") {
          setErrorMessage(stockEditNotAllowedMessage);
          return null;
        }
      }

      const resolved = resolveErrorMessage(error);
      setErrorMessage(resolved);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [stockEditNotAllowedMessage, versionConflictMessage]);

  return {
    isSubmitting,
    message,
    errorMessage,
    setMessage,
    setErrorMessage,
    submit,
  };
}
