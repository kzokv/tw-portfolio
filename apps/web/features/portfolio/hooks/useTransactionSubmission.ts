"use client";

import { useCallback, useState } from "react";
import type { TransactionInput } from "../../../components/portfolio/types";
import { submitTransaction } from "../services/portfolioService";

interface UseTransactionSubmissionOptions {
  initialValue: TransactionInput;
  noAccountsMessage: string;
  refresh: () => Promise<void>;
}

export function useTransactionSubmission({
  initialValue,
  noAccountsMessage,
  refresh,
}: UseTransactionSubmissionOptions) {
  const [draftTransaction, setDraftTransaction] = useState<TransactionInput>(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submit = useCallback(async () => {
    if (!draftTransaction.accountId) {
      setErrorMessage(noAccountsMessage);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      await submitTransaction(draftTransaction);
      await refresh();
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [draftTransaction, noAccountsMessage, refresh]);

  return {
    draftTransaction,
    setDraftTransaction,
    isSubmitting,
    errorMessage,
    setErrorMessage,
    submit,
  };
}
