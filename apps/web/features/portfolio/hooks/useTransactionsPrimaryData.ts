"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const initialCacheKeyRef = useRef(cacheKey);
  const requestVersionRef = useRef(0);

  const startRequest = useCallback(() => {
    requestVersionRef.current += 1;
    return requestVersionRef.current;
  }, []);

  const isCurrentRequest = useCallback((version: number) => version === requestVersionRef.current, []);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const next = await fetchTransactionsPrimaryData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      if (cacheKey) writeRouteDtoCache(cacheKey, next);
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [cacheKey, isCurrentRequest, startRequest]);

  useEffect(() => {
    const shouldUseInitialData = initialPrimaryData !== null && initialCacheKeyRef.current === cacheKey;
    if (shouldUseInitialData) {
      startRequest();
      setData(initialPrimaryData);
      if (cacheKey) writeRouteDtoCache(cacheKey, initialPrimaryData);
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      return;
    }

    const cached = cacheKey ? readRouteDtoCache<TransactionPrimaryDto>(cacheKey) : null;
    if (cached !== null) {
      setData(cached.payload);
      setIsBootstrapping(false);
      setRestoredFromCache(true);
      setRestoredAt(cached.savedAt);
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
  }, [cacheKey, initialPrimaryData, refresh, startRequest]);

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
