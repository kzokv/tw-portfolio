"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnyReportDto } from "../services/reportService";
import { fetchReport } from "../services/reportService";
import type { ReportRouteState } from "../reportState";
import { buildRouteDtoCacheKey, readRouteDtoCache, writeRouteDtoCache } from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import type { LocaleCode } from "@vakwen/shared-types";

export const REPORT_CLIENT_REFRESH_TIMEOUT_MS = 90_000;
const REPORT_REFRESH_TIMEOUT_MESSAGE = "Report refresh timed out. Try refreshing again.";

export function useReportData({
  cacheScope,
  contextRefreshSignal,
  initialReport,
  locale,
  state,
}: {
  cacheScope: string;
  contextRefreshSignal: number;
  initialReport: AnyReportDto | null;
  locale: LocaleCode;
  state: ReportRouteState;
}) {
  const cacheKey = useMemo(
    () => buildRouteDtoCacheKey(
      "reports",
      state.tab,
      cacheScope,
      locale,
      state.scope,
      state.range,
    ),
    [cacheScope, locale, state.range, state.scope, state.tab],
  );
  const [data, setData] = useState<AnyReportDto | null>(initialReport);
  const [isBootstrapping, setIsBootstrapping] = useState(initialReport === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const initialCacheScopeRef = useRef(cacheScope);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async ({ bypassCache = false }: { bypassCache?: boolean } = {}) => {
    requestVersionRef.current += 1;
    const version = requestVersionRef.current;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REPORT_CLIENT_REFRESH_TIMEOUT_MS);
    setIsRefreshing(true);
    try {
      if (!bypassCache) {
        const cached = readRouteDtoCache<AnyReportDto>(cacheKey);
        if (cached) {
          setData(cached.payload);
          setRestoredFromCache(true);
          setRestoredAt(cached.savedAt);
        }
      }
      const next = await fetchReport(state.tab, state, { signal: controller.signal });
      if (version !== requestVersionRef.current) return;
      setData(next);
      writeRouteDtoCache(cacheKey, next);
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
    } catch (error) {
      if (version !== requestVersionRef.current) return;
      setErrorMessage(isAbortError(error) ? REPORT_REFRESH_TIMEOUT_MESSAGE : resolveErrorMessage(error));
    } finally {
      clearTimeout(timeoutId);
      if (version === requestVersionRef.current) setIsRefreshing(false);
    }
  }, [cacheKey, state]);

  useEffect(() => {
    const shouldUseInitialReport = initialReport !== null
      && contextRefreshSignal === 0
      && initialCacheScopeRef.current === cacheScope
      && reportMatchesState(initialReport, state);
    const cached = shouldUseInitialReport ? null : readRouteDtoCache<AnyReportDto>(cacheKey);
    if (shouldUseInitialReport) {
      setData(initialReport);
      writeRouteDtoCache(cacheKey, initialReport);
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      return;
    }
    if (cached) {
      setData(cached.payload);
      setIsBootstrapping(false);
      setRestoredFromCache(true);
      setRestoredAt(cached.savedAt);
      void refresh();
      return;
    }
    setData(null);
    setIsBootstrapping(true);
    void refresh({ bypassCache: true }).finally(() => setIsBootstrapping(false));
  }, [cacheKey, contextRefreshSignal, initialReport, refresh, state]);

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

function reportMatchesState(report: AnyReportDto, state: ReportRouteState): boolean {
  if (!reportMatchesTab(report, state.tab)) return false;
  if (report.query.scope !== state.scope) return false;
  if (report.query.range !== state.range) return false;
  return true;
}

function reportMatchesTab(report: AnyReportDto, tab: ReportRouteState["tab"]): boolean {
  if (tab === "daily-review") return "suggestions" in report && "topMovers" in report && "holdings" in report;
  if (tab === "portfolio") return "performance" in report && "allocation" in report && "income" in report;
  return "performance" in report && "marketSummary" in report && "detail" in report;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}
