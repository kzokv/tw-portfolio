"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TransactionInput } from "../../../components/portfolio/types";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchDashboardEnrichmentData, fetchDashboardPrimaryData } from "../services/dashboardService";
import { resolveTransactionDraftAccount, type DashboardSnapshot } from "../types";

interface UseDashboardDataOptions {
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
  initialTransaction,
  initialPrimaryData = null,
}: UseDashboardDataOptions): UseDashboardDataResult {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initialPrimaryData ?? EMPTY_SNAPSHOT);
  const [isBootstrapping, setIsBootstrapping] = useState(initialPrimaryData === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(
    Boolean(initialPrimaryData?.actions.integrityIssue),
  );
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
      setShowIntegrityDialog(Boolean(nextSnapshot.actions.integrityIssue));
      setErrorMessage("");
    } catch {
      // Secondary market/FX/freshness enrichment must not blank primary content.
    }
  }, [isCurrentRequest]);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const nextSnapshot = await fetchDashboardPrimaryData();
      if (!isCurrentRequest(version)) return;
      setSnapshot(nextSnapshot);
      setShowIntegrityDialog(Boolean(nextSnapshot.actions.integrityIssue));
      setErrorMessage("");
      void refreshEnrichment(version);
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
      throw error;
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [isCurrentRequest, refreshEnrichment, startRequest]);

  useEffect(() => {
    if (initialPrimaryData !== null) {
      const version = startRequest();
      setSnapshot(initialPrimaryData);
      setShowIntegrityDialog(Boolean(initialPrimaryData.actions.integrityIssue));
      setIsBootstrapping(false);
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
  }, [initialPrimaryData, refresh, refreshEnrichment, startRequest]);

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
    synchronizeTransactionDraft: snapshot.accounts.length > 0
      ? synchronizeTransactionDraft
      : synchronizeInitialTransactionDraft,
  };
}
