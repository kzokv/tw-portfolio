"use client";

import { useCallback, useEffect, useState } from "react";
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

  const refreshEnrichment = useCallback(async () => {
    try {
      const next = await fetchPortfolioEnrichmentData();
      setData(next);
      setErrorMessage("");
    } catch {
      // Secondary quote/freshness/dividend enrichment must not blank primary content.
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await fetchPortfolioPrimaryData();
      setData(next);
      setErrorMessage("");
      void refreshEnrichment();
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshEnrichment]);

  useEffect(() => {
    if (initialPrimaryData !== null) {
      setData(initialPrimaryData);
      setIsBootstrapping(false);
      void refreshEnrichment();
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
  }, [initialPrimaryData, refresh]);

  return {
    data,
    isBootstrapping,
    isRefreshing,
    errorMessage,
    refresh,
  };
}
