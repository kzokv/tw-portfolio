"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TransactionHistoryPageDto } from "@vakwen/shared-types";
import { resolveErrorMessage } from "../../../lib/utils";
import {
  fetchTransactionHistoryPage,
  type TransactionHistoryPageQuery,
} from "../services/portfolioService";

const EMPTY_TRANSACTION_HISTORY_PAGE: TransactionHistoryPageDto = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  aggregates: {
    realizedPnlByCurrency: [],
  },
};

export function useTransactionHistory(
  query: TransactionHistoryPageQuery,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [data, setData] = useState<TransactionHistoryPageDto>(EMPTY_TRANSACTION_HISTORY_PAGE);
  const [isLoading, setIsLoading] = useState(enabled);
  const [errorMessage, setErrorMessage] = useState("");
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      requestVersionRef.current += 1;
      setData(EMPTY_TRANSACTION_HISTORY_PAGE);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    requestVersionRef.current += 1;
    const version = requestVersionRef.current;
    setIsLoading(true);

    try {
      const next = await fetchTransactionHistoryPage(query);
      if (version !== requestVersionRef.current) return;
      setData(next);
      setErrorMessage("");
    } catch (error) {
      if (version !== requestVersionRef.current) return;
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      if (version === requestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [enabled, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    errorMessage,
    isLoading,
    refresh,
  };
}
