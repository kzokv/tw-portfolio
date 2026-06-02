"use client";

import { useCallback, useEffect, useState } from "react";
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

  const refreshEnrichment = useCallback(async () => {
    try {
      const nextSnapshot = await fetchDashboardEnrichmentData();
      setSnapshot(nextSnapshot);
      setShowIntegrityDialog(Boolean(nextSnapshot.actions.integrityIssue));
      setErrorMessage("");
    } catch {
      // Secondary market/FX/freshness enrichment must not blank primary content.
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const nextSnapshot = await fetchDashboardPrimaryData();
      setSnapshot(nextSnapshot);
      setShowIntegrityDialog(Boolean(nextSnapshot.actions.integrityIssue));
      setErrorMessage("");
      void refreshEnrichment();
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshEnrichment]);

  useEffect(() => {
    if (initialPrimaryData !== null) {
      setSnapshot(initialPrimaryData);
      setShowIntegrityDialog(Boolean(initialPrimaryData.actions.integrityIssue));
      setIsBootstrapping(false);
      void refreshEnrichment();
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
  }, [initialPrimaryData, refresh]);

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
