"use client";

import { useCallback, useEffect, useState } from "react";
import type { TransactionInput } from "../portfolio/types";
import { resolveErrorMessage } from "../../lib/utils";
import { resolveTransactionDraftAccount } from "../../features/dashboard/types";
import {
  fetchShellPortfolioConfig,
  type ShellPortfolioConfigDto,
} from "../../features/settings/services/shellPortfolioConfigService";

interface UseShellPortfolioConfigOptions {
  initialTransaction: TransactionInput;
  initialConfig?: ShellPortfolioConfigDto | null;
}

interface UseShellPortfolioConfigResult extends ShellPortfolioConfigDto {
  isLoading: boolean;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  refresh: () => Promise<void>;
  synchronizeTransactionDraft: (previous: TransactionInput) => TransactionInput;
}

const EMPTY_CONFIG: ShellPortfolioConfigDto = {
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

export function useShellPortfolioConfig({
  initialTransaction,
  initialConfig = null,
}: UseShellPortfolioConfigOptions): UseShellPortfolioConfigResult {
  const [config, setConfig] = useState<ShellPortfolioConfigDto>(initialConfig ?? EMPTY_CONFIG);
  const [isLoading, setIsLoading] = useState(initialConfig === null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(Boolean(initialConfig?.integrityIssue));

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextConfig = await fetchShellPortfolioConfig();
      setConfig(nextConfig);
      setShowIntegrityDialog(Boolean(nextConfig.integrityIssue));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialConfig !== null) {
      setConfig(initialConfig);
      setShowIntegrityDialog(Boolean(initialConfig.integrityIssue));
      setIsLoading(false);
      return;
    }

    let mounted = true;
    void refresh().catch(() => {
      if (!mounted) return;
    });
    return () => {
      mounted = false;
    };
  }, [initialConfig, refresh]);

  const synchronizeTransactionDraft = useCallback(
    (previous: TransactionInput) =>
      resolveTransactionDraftAccount(
        previous,
        config.accounts,
        config.feeProfiles,
        config.feeProfileBindings,
      ),
    [config.accounts, config.feeProfileBindings, config.feeProfiles],
  );

  const synchronizeInitialDraft = useCallback(
    () => resolveTransactionDraftAccount(initialTransaction, [], [], []),
    [initialTransaction],
  );

  return {
    ...config,
    isLoading,
    errorMessage,
    setErrorMessage,
    showIntegrityDialog,
    setShowIntegrityDialog,
    refresh,
    synchronizeTransactionDraft: config.accounts.length > 0 ? synchronizeTransactionDraft : synchronizeInitialDraft,
  };
}
