"use client";

import { useCallback, useState } from "react";
import { resolveErrorMessage } from "../../../lib/utils";
import type { TransactionInput } from "../../../components/portfolio/types";
import { submitTransaction } from "../services/portfolioService";

interface UseTransactionSubmissionOptions {
  initialValue: TransactionInput;
  noAccountsMessage: string;
  successMessage: string;
  refresh: () => Promise<void>;
}

export function useTransactionSubmission({
  initialValue,
  noAccountsMessage,
  successMessage,
  refresh,
}: UseTransactionSubmissionOptions) {
  const [draftTransaction, setDraftTransaction] = useState<TransactionInput>(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const submit = useCallback(async () => {
    if (!draftTransaction.accountId) {
      setMessage("");
      setErrorMessage(noAccountsMessage);
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setErrorMessage("");

    try {
      await submitTransaction(draftTransaction);
      await refresh();
      setMessage(successMessage);
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [draftTransaction, noAccountsMessage, refresh, successMessage]);

  return {
    draftTransaction,
    setDraftTransaction,
    isSubmitting,
    message,
    setMessage,
    errorMessage,
    setErrorMessage,
    submit,
  };
}
