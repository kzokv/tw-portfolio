"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readRouteDtoCache,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import {
  fetchPortfolioEnrichmentData,
  fetchPortfolioPrimaryData,
  type PortfolioPageData,
} from "../services/portfolioService";

const EMPTY_PORTFOLIO_PAGE_DATA: PortfolioPageData = {
  holdings: [],
  holdingGroups: [],
  dividends: {
    upcoming: [],
    recent: [],
  },
  instruments: [],
  fxRates: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

export function usePortfolioPrimaryData(
  initialPrimaryData: PortfolioPageData | null = null,
  cacheKey?: string,
) {
  const initialCachedRef = useRef<{ payload: PortfolioPageData; savedAt: number } | null | undefined>(undefined);
  if (initialCachedRef.current === undefined) {
    initialCachedRef.current = initialPrimaryData === null && cacheKey
      ? readRouteDtoCache<PortfolioPageData>(cacheKey)
      : null;
  }
  const initialCached = initialCachedRef.current;
  const [data, setData] = useState<PortfolioPageData>(initialPrimaryData ?? initialCached?.payload ?? EMPTY_PORTFOLIO_PAGE_DATA);
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

  const refreshEnrichment = useCallback(async (version: number) => {
    try {
      const next = await fetchPortfolioEnrichmentData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      if (cacheKey) writeRouteDtoCache(cacheKey, next);
      setErrorMessage("");
    } catch {
      // Secondary quote/freshness/dividend enrichment must not blank primary content.
    }
  }, [cacheKey, isCurrentRequest]);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const next = await fetchPortfolioPrimaryData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      if (cacheKey) writeRouteDtoCache(cacheKey, next);
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      void refreshEnrichment(version);
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [cacheKey, isCurrentRequest, refreshEnrichment, startRequest]);

  useEffect(() => {
    const shouldUseInitialData = initialPrimaryData !== null && initialCacheKeyRef.current === cacheKey;
    if (shouldUseInitialData) {
      const version = startRequest();
      setData(initialPrimaryData);
      if (cacheKey) writeRouteDtoCache(cacheKey, initialPrimaryData);
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      void refreshEnrichment(version);
      return;
    }

    const cached = cacheKey ? readRouteDtoCache<PortfolioPageData>(cacheKey) : null;
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
  }, [cacheKey, initialPrimaryData, refresh, refreshEnrichment, startRequest]);

  return {
    data,
    isBootstrapping,
    isRefreshing,
    errorMessage,
    refresh,
    restoredFromCache,
    restoredAt,
  };
}
