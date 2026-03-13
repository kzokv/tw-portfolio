"use client";

import { useCallback, useEffect, useState } from "react";
import type { TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchTransactionHistory } from "../services/portfolioService";

interface UseRecentTransactionsOptions {
  limit: number;
  enabled?: boolean;
}

export function useRecentTransactions({
  limit,
  enabled = true,
}: UseRecentTransactionsOptions) {
  const [items, setItems] = useState<TransactionHistoryItemDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setErrorMessage("");
      return;
    }

    setIsLoading(true);
    try {
      const nextItems = await fetchTransactionHistory({ limit });
      setItems(nextItems);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [enabled, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    items,
    isLoading,
    errorMessage,
    refresh,
  };
}
