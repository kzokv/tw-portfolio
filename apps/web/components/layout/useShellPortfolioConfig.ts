"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  fetchMode?: "eager" | "lazy";
}

interface UseShellPortfolioConfigResult extends ShellPortfolioConfigDto {
  isLoading: boolean;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  ensureLoaded: () => Promise<void>;
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
  fetchMode = "eager",
}: UseShellPortfolioConfigOptions): UseShellPortfolioConfigResult {
  const [config, setConfig] = useState<ShellPortfolioConfigDto>(initialConfig ?? EMPTY_CONFIG);
  const [isLoading, setIsLoading] = useState(initialConfig === null && fetchMode === "eager");
  const [errorMessage, setErrorMessage] = useState("");
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(Boolean(initialConfig?.integrityIssue));
  const hasLoadedRef = useRef(initialConfig !== null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextConfig = await fetchShellPortfolioConfig();
      setConfig(nextConfig);
      setShowIntegrityDialog(Boolean(nextConfig.integrityIssue));
      setErrorMessage("");
      hasLoadedRef.current = true;
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (hasLoadedRef.current) return;
    loadPromiseRef.current ??= fetchConfig().finally(() => {
      loadPromiseRef.current = null;
    });
    await loadPromiseRef.current;
  }, [fetchConfig]);

  const refresh = useCallback(async () => {
    await fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (initialConfig !== null) {
      setConfig(initialConfig);
      setShowIntegrityDialog(Boolean(initialConfig.integrityIssue));
      setIsLoading(false);
      hasLoadedRef.current = true;
      return;
    }

    if (fetchMode === "lazy") {
      setConfig(EMPTY_CONFIG);
      setShowIntegrityDialog(false);
      setIsLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    let mounted = true;
    void ensureLoaded().catch(() => {
      if (!mounted) return;
    });
    return () => {
      mounted = false;
    };
  }, [ensureLoaded, fetchMode, initialConfig]);

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
    ensureLoaded,
    refresh,
    synchronizeTransactionDraft: config.accounts.length > 0 ? synchronizeTransactionDraft : synchronizeInitialDraft,
  };
}
