"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

export function usePortfolioPrimaryData(initialPrimaryData: PortfolioPageData | null = null) {
  const [data, setData] = useState<PortfolioPageData>(initialPrimaryData ?? EMPTY_PORTFOLIO_PAGE_DATA);
  const [isBootstrapping, setIsBootstrapping] = useState(initialPrimaryData === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
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
      setErrorMessage("");
    } catch {
      // Secondary quote/freshness/dividend enrichment must not blank primary content.
    }
  }, [isCurrentRequest]);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const next = await fetchPortfolioPrimaryData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      setErrorMessage("");
      void refreshEnrichment(version);
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [isCurrentRequest, refreshEnrichment, startRequest]);

  useEffect(() => {
    if (initialPrimaryData !== null) {
      const version = startRequest();
      setData(initialPrimaryData);
      setIsBootstrapping(false);
      void refreshEnrichment(version);
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
  }, [initialPrimaryData, refresh, refreshEnrichment, startRequest]);

  return {
    data,
    isBootstrapping,
    isRefreshing,
    errorMessage,
    refresh,
  };
}
