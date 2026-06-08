"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";
import type { TransactionInput } from "../../../components/portfolio/types";
import {
  readRouteDtoCache,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchDashboardEnrichmentData, fetchDashboardPrimaryData } from "../services/dashboardService";
import { resolveTransactionDraftAccount, type DashboardSnapshot } from "../types";

interface UseDashboardDataOptions {
  cacheKey?: string;
  expectedReportingCurrency?: AccountDefaultCurrency | null;
  initialTransaction: TransactionInput;
  initialPrimaryData?: DashboardSnapshot | null;
}

interface UseDashboardDataResult extends DashboardSnapshot {
  isBootstrapping: boolean;
  isRefreshing: boolean;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  refresh: () => Promise<void>;
  restoredFromCache: boolean;
  restoredAt: number | null;
  synchronizeTransactionDraft: (previous: TransactionInput) => TransactionInput;
}

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  settings: null,
  summary: {
    asOf: "",
    accountCount: 0,
    holdingCount: 0,
    totalCostAmount: 0,
    // KZO-180: reportingCurrency replaces broken-by-design totalCostCurrency.
    reportingCurrency: "TWD",
    fxStatus: "complete",
    marketValueAmount: null,
    unrealizedPnlAmount: null,
    dailyChangeAmount: null,
    dailyChangePercent: null,
    upcomingDividendCount: 0,
    upcomingDividendAmount: null,
    openIssueCount: 0,
  },
  holdings: [],
  holdingGroups: [],
  dividends: {
    upcoming: [],
    recent: [],
  },
  actions: {
    integrityIssue: null,
    recomputeAvailable: true,
  },
  instruments: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
};

export function useDashboardPrimaryData({
  cacheKey,
  expectedReportingCurrency,
  initialTransaction,
  initialPrimaryData = null,
}: UseDashboardDataOptions): UseDashboardDataResult {
  const initialCachedRef = useRef<{ payload: DashboardSnapshot; savedAt: number } | null | undefined>(undefined);
  if (initialCachedRef.current === undefined) {
    initialCachedRef.current = initialPrimaryData === null && cacheKey
      ? readDashboardCache(cacheKey, expectedReportingCurrency)
      : null;
  }
  const initialCached = initialCachedRef.current;
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initialPrimaryData ?? initialCached?.payload ?? EMPTY_SNAPSHOT);
  const [isBootstrapping, setIsBootstrapping] = useState(initialPrimaryData === null && initialCached === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(
    Boolean((initialPrimaryData ?? initialCached?.payload)?.actions.integrityIssue),
  );
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
      const nextSnapshot = await fetchDashboardEnrichmentData();
      if (!isCurrentRequest(version)) return;
      setSnapshot(nextSnapshot);
      if (cacheKey) writeRouteDtoCache(cacheKey, nextSnapshot);
      setShowIntegrityDialog(Boolean(nextSnapshot.actions.integrityIssue));
      setErrorMessage("");
    } catch {
      // Secondary market/FX/freshness enrichment must not blank primary content.
    }
  }, [cacheKey, isCurrentRequest]);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const nextSnapshot = await fetchDashboardPrimaryData();
      if (!isCurrentRequest(version)) return;
      setSnapshot(nextSnapshot);
      if (cacheKey) writeRouteDtoCache(cacheKey, nextSnapshot);
      setShowIntegrityDialog(Boolean(nextSnapshot.actions.integrityIssue));
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      void refreshEnrichment(version);
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
      throw error;
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [cacheKey, isCurrentRequest, refreshEnrichment, startRequest]);

  useEffect(() => {
    const shouldUseInitialData = initialPrimaryData !== null && initialCacheKeyRef.current === cacheKey;
    if (shouldUseInitialData) {
      const version = startRequest();
      setSnapshot(initialPrimaryData);
      if (cacheKey) writeRouteDtoCache(cacheKey, initialPrimaryData);
      setShowIntegrityDialog(Boolean(initialPrimaryData.actions.integrityIssue));
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      void refreshEnrichment(version);
      return;
    }

    const cached = cacheKey ? readDashboardCache(cacheKey, expectedReportingCurrency) : null;
    if (cached !== null) {
      const version = startRequest();
      setSnapshot(cached.payload);
      setShowIntegrityDialog(Boolean(cached.payload.actions.integrityIssue));
      setIsBootstrapping(false);
      setRestoredFromCache(true);
      setRestoredAt(cached.savedAt);
      void refresh();
      void refreshEnrichment(version);
      return;
    }

    let mounted = true;

    async function load() {
      try {
        await refresh();
      } catch {
        if (!mounted) return;
      } finally {
        if (mounted) setIsBootstrapping(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [cacheKey, expectedReportingCurrency, initialPrimaryData, refresh, refreshEnrichment, startRequest]);

  const synchronizeTransactionDraft = useCallback(
    (previous: TransactionInput) =>
      resolveTransactionDraftAccount(
        previous,
        snapshot.accounts,
        snapshot.feeProfiles,
        snapshot.feeProfileBindings,
      ),
    [snapshot.accounts, snapshot.feeProfileBindings, snapshot.feeProfiles],
  );
  const synchronizeInitialTransactionDraft = useCallback(
    () => resolveTransactionDraftAccount(initialTransaction, [], [], []),
    [initialTransaction],
  );

  return {
    ...snapshot,
    isBootstrapping,
    isRefreshing,
    errorMessage,
    setErrorMessage,
    showIntegrityDialog,
    setShowIntegrityDialog,
    refresh,
    restoredFromCache,
    restoredAt,
    synchronizeTransactionDraft: snapshot.accounts.length > 0
      ? synchronizeTransactionDraft
      : synchronizeInitialTransactionDraft,
  };
}

function readDashboardCache(
  cacheKey: string,
  expectedReportingCurrency?: AccountDefaultCurrency | null,
): { payload: DashboardSnapshot; savedAt: number } | null {
  if (expectedReportingCurrency === null) return null;

  const cached = readRouteDtoCache<DashboardSnapshot>(cacheKey);
  if (cached === null || expectedReportingCurrency === undefined) return cached;
  return cached.payload.summary.reportingCurrency === expectedReportingCurrency ? cached : null;
}
