"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveErrorMessage } from "../../../lib/utils";
import {
  fetchPortfolioPageData,
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
};

export function usePortfolioPageData() {
  const [data, setData] = useState<PortfolioPageData>(EMPTY_PORTFOLIO_PAGE_DATA);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await fetchPortfolioPageData();
      setData(next);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
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
  }, [refresh]);

  return {
    data,
    isBootstrapping,
    isRefreshing,
    errorMessage,
    refresh,
  };
}
