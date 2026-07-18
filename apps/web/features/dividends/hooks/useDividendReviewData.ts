"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DividendReviewEnrichmentDto,
  DividendReviewFilterDto,
  DividendReviewPrimaryDto,
  DividendReviewPrimaryQueryDto,
  RouteCachePolicyDto,
} from "@vakwen/shared-types";
import {
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import {
  DIVIDEND_REVIEW_ENRICHMENT_CACHE_TAG,
  DIVIDEND_REVIEW_PRIMARY_CACHE_TAG,
  buildDividendReviewEnrichmentCacheKey,
  buildDividendReviewPrimaryCacheKey,
  clearDividendReviewCaches,
} from "../dividendReviewCache";
import {
  fetchDividendReviewEnrichment,
  fetchDividendReviewPrimary,
} from "../services/dividendService";

export interface DividendReviewDataState {
  requestedQuery: DividendReviewPrimaryQueryDto;
  committedQuery: DividendReviewPrimaryQueryDto;
  committedPrimary: DividendReviewPrimaryDto | null;
  primary: DividendReviewPrimaryDto | null;
  enrichment: DividendReviewEnrichmentDto | null;
  primaryError: string;
  enrichmentError: string;
  isPrimaryPending: boolean;
  isPrimaryRefreshing: boolean;
  isEnrichmentPending: boolean;
}

interface CommittedSnapshot {
  query: DividendReviewPrimaryQueryDto;
  primary: DividendReviewPrimaryDto | null;
}

function filtersFromQuery(query: DividendReviewPrimaryQueryDto): DividendReviewFilterDto {
  return {
    fromPaymentDate: query.fromPaymentDate,
    toPaymentDate: query.toPaymentDate,
    accountId: query.accountId,
    ticker: query.ticker,
    marketCode: query.marketCode,
    postingStatus: query.postingStatus,
    cashStatus: query.cashStatus,
    stockStatus: query.stockStatus,
    reconciliationStatus: query.reconciliationStatus,
    excludeExpected: query.excludeExpected,
    sourceComposition: query.sourceComposition,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
    || typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

export function useDividendReviewData({
  cachePolicy,
  cacheScope,
  initialPrimary,
  initialQuery,
  onQueryRollback,
  onQueryRetry,
}: {
  cachePolicy?: RouteCachePolicyDto | null;
  cacheScope: string;
  initialPrimary: DividendReviewPrimaryDto | null;
  initialQuery: DividendReviewPrimaryQueryDto;
  onQueryRollback: (query: DividendReviewPrimaryQueryDto) => void;
  onQueryRetry: (query: DividendReviewPrimaryQueryDto) => void;
}) {
  const primaryDurations = resolveRouteDtoCacheDurations(cachePolicy, "dividend-review-primary");
  const enrichmentDurations = resolveRouteDtoCacheDurations(cachePolicy, "dividend-review-enrichment");
  const [state, setState] = useState<DividendReviewDataState>({
    requestedQuery: initialQuery,
    committedQuery: initialQuery,
    committedPrimary: initialPrimary,
    primary: initialPrimary,
    enrichment: null,
    primaryError: "",
    enrichmentError: "",
    isPrimaryPending: initialPrimary === null,
    isPrimaryRefreshing: false,
    isEnrichmentPending: true,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const committedRef = useRef<CommittedSnapshot>({ query: initialQuery, primary: initialPrimary });
  const primaryControllerRef = useRef<AbortController | null>(null);
  const enrichmentControllerRef = useRef<AbortController | null>(null);
  const enrichmentKeyRef = useRef<string | null>(null);
  const failedQueryRef = useRef<DividendReviewPrimaryQueryDto | null>(null);
  const initializedRef = useRef(false);

  const writePrimary = useCallback((query: DividendReviewPrimaryQueryDto, payload: DividendReviewPrimaryDto) => {
    writeRouteDtoCache(buildDividendReviewPrimaryCacheKey(cacheScope, query), payload, {
      ttlMs: primaryDurations.ttlMs,
      staleTtlMs: primaryDurations.staleTtlMs,
      tags: [DIVIDEND_REVIEW_PRIMARY_CACHE_TAG],
    });
  }, [cacheScope, primaryDurations.staleTtlMs, primaryDurations.ttlMs]);

  const loadEnrichment = useCallback(async (
    query: DividendReviewPrimaryQueryDto,
    options: { force?: boolean } = {},
  ) => {
    const key = buildDividendReviewEnrichmentCacheKey(cacheScope, query);
    if (!options.force && enrichmentKeyRef.current === key) return;

    enrichmentControllerRef.current?.abort();
    enrichmentKeyRef.current = key;
    const cached = options.force ? null : readRouteDtoCache<DividendReviewEnrichmentDto>(key);
    if (cached) {
      setState((current) => ({
        ...current,
        enrichment: cached.payload,
        enrichmentError: "",
        isEnrichmentPending: cached.status === "stale",
      }));
      if (cached.status === "fresh") return;
    } else {
      setState((current) => ({
        ...current,
        enrichment: null,
        enrichmentError: "",
        isEnrichmentPending: true,
      }));
    }

    const controller = new AbortController();
    enrichmentControllerRef.current = controller;
    try {
      const payload = await fetchDividendReviewEnrichment(filtersFromQuery(query), { signal: controller.signal });
      if (controller.signal.aborted || enrichmentKeyRef.current !== key) return;
      writeRouteDtoCache(key, payload, {
        ttlMs: enrichmentDurations.ttlMs,
        staleTtlMs: enrichmentDurations.staleTtlMs,
        tags: [DIVIDEND_REVIEW_ENRICHMENT_CACHE_TAG],
      });
      setState((current) => ({
        ...current,
        enrichment: payload,
        enrichmentError: "",
        isEnrichmentPending: false,
      }));
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || enrichmentKeyRef.current !== key) return;
      setState((current) => ({
        ...current,
        enrichmentError: errorMessage(error),
        isEnrichmentPending: false,
      }));
    }
  }, [cacheScope, enrichmentDurations.staleTtlMs, enrichmentDurations.ttlMs]);

  const request = useCallback(async (
    query: DividendReviewPrimaryQueryDto,
    options: { force?: boolean; refreshEnrichment?: boolean } = {},
  ) => {
    const previous = committedRef.current;
    primaryControllerRef.current?.abort();
    const key = buildDividendReviewPrimaryCacheKey(cacheScope, query);
    const cached = options.force ? null : readRouteDtoCache<DividendReviewPrimaryDto>(key);

    setState((current) => ({
      ...current,
      requestedQuery: query,
      primary: cached?.payload ?? null,
      committedPrimary: cached?.payload ?? current.committedPrimary,
      primaryError: "",
      isPrimaryPending: cached === null,
      isPrimaryRefreshing: cached?.status === "stale",
      ...(cached ? { committedQuery: query } : {}),
    }));
    if (cached) committedRef.current = { query, primary: cached.payload };
    const rollbackSnapshot = cached ? { query, primary: cached.payload } : previous;

    void loadEnrichment(query, { force: options.refreshEnrichment });
    if (cached?.status === "fresh") return;

    const controller = new AbortController();
    primaryControllerRef.current = controller;
    try {
      const payload = await fetchDividendReviewPrimary(query, { signal: controller.signal });
      if (controller.signal.aborted || primaryControllerRef.current !== controller) return;
      committedRef.current = { query, primary: payload };
      failedQueryRef.current = null;
      writePrimary(query, payload);
      setState((current) => ({
        ...current,
        requestedQuery: query,
        committedQuery: query,
        primary: payload,
        committedPrimary: payload,
        primaryError: "",
        isPrimaryPending: false,
        isPrimaryRefreshing: false,
      }));
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || primaryControllerRef.current !== controller) return;
      committedRef.current = rollbackSnapshot;
      failedQueryRef.current = query;
      onQueryRollback(rollbackSnapshot.query);
      setState((current) => ({
        ...current,
        requestedQuery: rollbackSnapshot.query,
        committedQuery: rollbackSnapshot.query,
        primary: rollbackSnapshot.primary,
        committedPrimary: rollbackSnapshot.primary,
        enrichment: null,
        primaryError: errorMessage(error),
        isPrimaryPending: false,
        isPrimaryRefreshing: false,
      }));
      enrichmentKeyRef.current = null;
      void loadEnrichment(rollbackSnapshot.query);
    }
  }, [cacheScope, loadEnrichment, onQueryRollback, writePrimary]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (initialPrimary) {
      writePrimary(initialQuery, initialPrimary);
      void loadEnrichment(initialQuery);
    } else {
      void request(initialQuery);
    }
  }, [initialPrimary, initialQuery, loadEnrichment, request, writePrimary]);

  useEffect(() => () => {
    primaryControllerRef.current?.abort();
    enrichmentControllerRef.current?.abort();
  }, []);

  const retryPrimary = useCallback(() => {
    const query = failedQueryRef.current ?? stateRef.current.requestedQuery;
    onQueryRetry(query);
    return request(query, { force: true, refreshEnrichment: true });
  }, [onQueryRetry, request]);
  const retryEnrichment = useCallback(
    () => loadEnrichment(stateRef.current.requestedQuery, { force: true }),
    [loadEnrichment],
  );
  const invalidateAndRefresh = useCallback((options: { resetPage?: boolean; discardCommitted?: boolean } = {}) => {
    clearDividendReviewCaches();
    const query = options.resetPage
      ? { ...stateRef.current.requestedQuery, page: 1 }
      : stateRef.current.requestedQuery;
    if (options.discardCommitted) {
      committedRef.current = { query, primary: null };
      enrichmentKeyRef.current = null;
      setState((current) => ({
        ...current,
        requestedQuery: query,
        committedQuery: query,
        committedPrimary: null,
        primary: null,
        enrichment: null,
        primaryError: "",
        enrichmentError: "",
        isPrimaryPending: true,
        isPrimaryRefreshing: false,
        isEnrichmentPending: true,
      }));
    }
    return request(query, { force: true, refreshEnrichment: true });
  }, [request]);

  return useMemo(() => ({
    ...state,
    request,
    retryPrimary,
    retryEnrichment,
    invalidateAndRefresh,
  }), [invalidateAndRefresh, request, retryEnrichment, retryPrimary, state]);
}
