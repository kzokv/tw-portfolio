"use client";

import { useCallback, useEffect, useState } from "react";
import type { TransactionInput } from "../../../components/portfolio/types";
import { fetchDashboardSnapshot } from "../services/dashboardService";
import { resolveTransactionDraftAccount, type DashboardSnapshot } from "../types";

interface UseDashboardDataOptions {
  initialTransaction: TransactionInput;
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
  holdings: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

export function useDashboardData({ initialTransaction }: UseDashboardDataOptions): UseDashboardDataResult {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY_SNAPSHOT);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const nextSnapshot = await fetchDashboardSnapshot();
      setSnapshot(nextSnapshot);
      setShowIntegrityDialog(Boolean(nextSnapshot.integrityIssue));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(String(error));
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
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
  }, [refresh]);

  const synchronizeTransactionDraft = useCallback(
    (previous: TransactionInput) => resolveTransactionDraftAccount(previous, snapshot.accounts),
    [snapshot.accounts],
  );
  const synchronizeInitialTransactionDraft = useCallback(
    () => resolveTransactionDraftAccount(initialTransaction, []),
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
