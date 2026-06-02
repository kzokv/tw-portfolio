"use client";

import { useCallback, useEffect, useState } from "react";
import type { TransactionHistoryItemDto } from "@vakwen/shared-types";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchTransactionHistory } from "../services/portfolioService";

interface UseRecentTransactionsOptions {
  limit: number;
  enabled?: boolean;
  initialItems?: TransactionHistoryItemDto[] | null;
}

export function useRecentTransactions({
  limit,
  enabled = true,
  initialItems = null,
}: UseRecentTransactionsOptions) {
  const [items, setItems] = useState<TransactionHistoryItemDto[]>(initialItems ?? []);
  const [isLoading, setIsLoading] = useState(enabled && initialItems === null);
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
    if (!enabled) {
      setItems([]);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    if (initialItems !== null) {
      setItems(initialItems);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    void refresh();
  }, [enabled, initialItems, refresh]);

  return {
    items,
    isLoading,
    errorMessage,
    refresh,
  };
}
