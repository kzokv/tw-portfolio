"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnyReportDto } from "../services/reportService";
import { fetchReport } from "../services/reportService";
import type { ReportRouteState } from "../reportState";
import {
  buildRouteDtoCacheKey,
  buildRouteDtoCacheTag,
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  type RouteDtoCacheStatus,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import { ACCOUNT_DEFAULT_CURRENCIES, type LocaleCode, type RouteCachePolicyDto } from "@vakwen/shared-types";

export const REPORT_CLIENT_REFRESH_TIMEOUT_MS = 90_000;
const REPORT_REFRESH_TIMEOUT_MESSAGE = "Report refresh timed out. Try refreshing again.";

export function useReportData({
  cachePolicy,
  cacheScope,
  contextRefreshSignal,
  initialReport,
  locale,
  state,
}: {
  cachePolicy?: RouteCachePolicyDto | null;
  cacheScope: string;
  contextRefreshSignal: number;
  initialReport: AnyReportDto | null;
  locale: LocaleCode;
  state: ReportRouteState;
}) {
  const cacheDurations = resolveRouteDtoCacheDurations(cachePolicy, "reports");
  const buildReportCacheKey = useCallback(
    (reportingCurrency: string) => buildRouteDtoCacheKey(
      "reports",
      state.tab,
      cacheScope,
      locale,
      state.scope,
      state.range,
      reportingCurrency,
    ),
    [cacheScope, locale, state.range, state.scope, state.tab],
  );
  const expectedReportingCurrency = initialReport?.query.reportingCurrency ?? null;
  const cacheKey = useMemo(
    () => buildReportCacheKey(expectedReportingCurrency ?? "unknown"),
    [buildReportCacheKey, expectedReportingCurrency],
  );
  const [data, setData] = useState<AnyReportDto | null>(initialReport);
  const [isBootstrapping, setIsBootstrapping] = useState(initialReport === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cacheStatus, setCacheStatus] = useState<RouteDtoCacheStatus | null>(null);
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
        const cached = readMatchingReportCache(buildReportCacheKey, expectedReportingCurrency, state);
        if (cached) {
          setData(cached.payload);
          setCacheStatus(cached.status);
          setRestoredFromCache(true);
          setRestoredAt(cached.savedAt);
        }
      }
      const next = await fetchReport(state.tab, state, { signal: controller.signal });
      if (version !== requestVersionRef.current) return;
      setData(next);
      writeRouteDtoCache(buildReportCacheKey(next.query.reportingCurrency), next, {
        staleTtlMs: cacheDurations.staleTtlMs,
        tags: [buildRouteDtoCacheTag("route", "reports")],
        ttlMs: cacheDurations.ttlMs,
      });
      setErrorMessage("");
      setCacheStatus("fresh");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
    } catch (error) {
      if (version !== requestVersionRef.current) return;
      setErrorMessage(isAbortError(error) ? REPORT_REFRESH_TIMEOUT_MESSAGE : resolveErrorMessage(error));
    } finally {
      clearTimeout(timeoutId);
      if (version === requestVersionRef.current) setIsRefreshing(false);
    }
  }, [buildReportCacheKey, cacheDurations.staleTtlMs, cacheDurations.ttlMs, expectedReportingCurrency, state]);

  useEffect(() => {
    const shouldUseInitialReport = initialReport !== null
      && contextRefreshSignal === 0
      && initialCacheScopeRef.current === cacheScope
      && reportMatchesState(initialReport, state);
    const cached = shouldUseInitialReport
      ? null
      : readMatchingReportCache(buildReportCacheKey, expectedReportingCurrency, state);
    if (shouldUseInitialReport) {
      setData(initialReport);
      writeRouteDtoCache(buildReportCacheKey(initialReport.query.reportingCurrency), initialReport, {
        staleTtlMs: cacheDurations.staleTtlMs,
        tags: [buildRouteDtoCacheTag("route", "reports")],
        ttlMs: cacheDurations.ttlMs,
      });
      setIsBootstrapping(false);
      setCacheStatus("fresh");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      return;
    }
    if (cached) {
      setData(cached.payload);
      setIsBootstrapping(false);
      setCacheStatus(cached.status);
      setRestoredFromCache(true);
      setRestoredAt(cached.savedAt);
      if (cached.status === "stale" || expectedReportingCurrency === null) {
        void refresh({ bypassCache: true });
      }
      return;
    }
    setData(null);
    setIsBootstrapping(true);
    void refresh({ bypassCache: true }).finally(() => setIsBootstrapping(false));
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, contextRefreshSignal, initialReport, refresh, state]);

  return {
    data,
    errorMessage,
    isBootstrapping,
    cacheStatus,
    isRefreshing,
    refresh,
    restoredFromCache,
    restoredAt,
  };
}

function readMatchingReportCache(
  buildReportCacheKey: (reportingCurrency: string) => string,
  expectedReportingCurrency: string | null,
  state: ReportRouteState,
): ReturnType<typeof readRouteDtoCache<AnyReportDto>> {
  const currencies = expectedReportingCurrency ? [expectedReportingCurrency] : ACCOUNT_DEFAULT_CURRENCIES;
  let best: ReturnType<typeof readRouteDtoCache<AnyReportDto>> = null;
  for (const currency of currencies) {
    const cached = readRouteDtoCache<AnyReportDto>(buildReportCacheKey(currency));
    if (!cached) continue;
    if (cached.payload.query.reportingCurrency !== currency) continue;
    if (!reportMatchesState(cached.payload, state)) continue;
    if (!best || cached.savedAt > best.savedAt) best = cached;
  }
  return best;
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
