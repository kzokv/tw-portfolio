"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardPerformanceDto, DashboardPerformanceRange } from "@tw-portfolio/shared-types";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchDashboardPerformance } from "../services/dashboardService";

interface UseDashboardPerformanceOptions {
  range: DashboardPerformanceRange;
  enabled?: boolean;
}

export function useDashboardPerformance({
  range,
  enabled = true,
}: UseDashboardPerformanceOptions) {
  const [data, setData] = useState<DashboardPerformanceDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) {
      setData(null);
      setErrorMessage("");
      return;
    }

    setIsLoading(true);
    try {
      const next = await fetchDashboardPerformance(range);
      setData(next);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [enabled, range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    isLoading,
    errorMessage,
    refresh,
  };
}
