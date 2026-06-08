"use client";

import { useCallback, useEffect, useState } from "react";
import type { TransactionPrimaryDto } from "@vakwen/shared-types";
import {
  readRouteDtoCache,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchTransactionsPrimaryData } from "../services/portfolioService";

const EMPTY_PRIMARY_DATA: TransactionPrimaryDto = {
  recentTransactions: [],
  accountOptions: [],
  portfolioConfig: {
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    integrityIssue: null,
  },
};

export function useTransactionsPrimaryData(
  initialPrimaryData: TransactionPrimaryDto | null = null,
  cacheKey?: string,
) {
  const initialCachedRef = useState<{ payload: TransactionPrimaryDto; savedAt: number } | null>(() =>
    initialPrimaryData === null && cacheKey
      ? readRouteDtoCache<TransactionPrimaryDto>(cacheKey)
      : null,
  )[0];
  const initialCached = initialCachedRef;
  const [data, setData] = useState<TransactionPrimaryDto>(initialPrimaryData ?? initialCached?.payload ?? EMPTY_PRIMARY_DATA);
  const [isBootstrapping, setIsBootstrapping] = useState(initialPrimaryData === null && initialCached === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [restoredFromCache, setRestoredFromCache] = useState(initialPrimaryData === null && initialCached !== null);
  const [restoredAt, setRestoredAt] = useState<number | null>(initialCached?.savedAt ?? null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await fetchTransactionsPrimaryData();
      setData(next);
      if (cacheKey) writeRouteDtoCache(cacheKey, next);
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (initialPrimaryData !== null) {
      setData(initialPrimaryData);
      if (cacheKey) writeRouteDtoCache(cacheKey, initialPrimaryData);
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      return;
    }

    if (initialCached !== null) {
      setData(initialCached.payload);
      setIsBootstrapping(false);
      setRestoredFromCache(true);
      setRestoredAt(initialCached.savedAt);
      void refresh();
      return;
    }

    let mounted = true;
    async function load() {
      try {
        await refresh();
      } finally {
        if (mounted) setIsBootstrapping(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [cacheKey, initialCached, initialPrimaryData, refresh]);

  return {
    data,
    errorMessage,
    isBootstrapping,
    isRefreshing,
    refresh,
    restoredFromCache,
    restoredAt,
  };
}
