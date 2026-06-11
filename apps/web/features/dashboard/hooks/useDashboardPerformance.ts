"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardPerformanceDto, DashboardPerformanceRange } from "@vakwen/shared-types";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchDashboardPerformanceEnrichment } from "../services/dashboardService";

export const DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS = 90_000;

interface UseDashboardPerformanceOptions {
  range: DashboardPerformanceRange;
  enabled?: boolean;
  timeoutMessage: string;
}

export function useDashboardPerformance({
  range,
  enabled = true,
  timeoutMessage,
}: UseDashboardPerformanceOptions) {
  const [data, setData] = useState<DashboardPerformanceDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const activeControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeControllerRef.current?.abort();
    if (!enabled) {
      setData(null);
      setErrorMessage("");
      setIsLoading(false);
      activeControllerRef.current = null;
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS);
    setIsLoading(true);
    try {
      const next = await fetchDashboardPerformanceEnrichment(range, { signal: controller.signal });
      if (activeControllerRef.current === controller) {
        setData(next);
        setErrorMessage("");
      }
    } catch (error) {
      if (activeControllerRef.current === controller) {
        setErrorMessage(isAbortError(error) ? timeoutMessage : resolveErrorMessage(error));
      }
    } finally {
      clearTimeout(timeoutId);
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [enabled, range, timeoutMessage]);

  useEffect(() => {
    void refresh();
    return () => {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, [refresh]);

  return {
    data,
    isLoading,
    errorMessage,
    refresh,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}
