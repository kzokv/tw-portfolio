"use client";

import { useMemo } from "react";
import type {
  AccountDto,
  AccountDefaultCurrency,
  FeeProfileBindingDto,
  FeeProfileDto,
  LocaleCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import type {
  AppShellData,
  AppShellTransactionAccountOption,
} from "./AppShellDataContext";
import type { IntegrityIssue } from "../../features/dashboard/types";
import type { useTransactionSubmission as useTransactionSubmissionType } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { useTransactionMutations as useTransactionMutationsType } from "../../features/portfolio/hooks/useTransactionMutations";
import type { useRecomputeAction as useRecomputeActionType } from "../../features/portfolio/hooks/useRecomputeAction";

interface BuildAppShellDataValueOptions {
  uiDict: AppDictionary;
  locale: LocaleCode;
  sessionUserId: string | null;
  isSharedContext: boolean;
  canUseGlobalQuickActions: boolean;
  openQuickActions: () => void;
  reportingCurrency: AccountDefaultCurrency;
  saveReportingCurrency: (currency: AccountDefaultCurrency) => Promise<void>;
  isReportingCurrencySaving: boolean;
  reportingCurrencyError: string;
  transactionSubmission: ReturnType<typeof useTransactionSubmissionType>;
  mutations: ReturnType<typeof useTransactionMutationsType>;
  recomputeAction: ReturnType<typeof useRecomputeActionType>;
  openRecomputeConfirm: () => void;
  transactionAccountOptions: AppShellTransactionAccountOption[];
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  refreshPortfolioConfig: () => Promise<void>;
  isPortfolioConfigLoading: boolean;
  integrityIssue: IntegrityIssue | null;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  generateSnapshots: () => Promise<void>;
  isGeneratingSnapshots: boolean;
  contextRefreshSignal: number;
}

/**
 * Builds the memoized `AppShellData` provider value consumed by every page
 * via `useAppShellData()`. Extracted from `AppShell.tsx` per Phase 3c spec
 * target (AppShell ≤300 LOC).
 */
export function useAppShellDataValue(options: BuildAppShellDataValueOptions): AppShellData {
  const {
    uiDict,
    locale,
    sessionUserId,
    isSharedContext,
    canUseGlobalQuickActions,
    openQuickActions,
    reportingCurrency,
    saveReportingCurrency,
    isReportingCurrencySaving,
    reportingCurrencyError,
    transactionSubmission,
    mutations,
    recomputeAction,
    openRecomputeConfirm,
    transactionAccountOptions,
    accounts,
    feeProfiles,
    feeProfileBindings,
    refreshPortfolioConfig,
    isPortfolioConfigLoading,
    integrityIssue,
    showIntegrityDialog,
    setShowIntegrityDialog,
    generateSnapshots,
    isGeneratingSnapshots,
    contextRefreshSignal,
  } = options;

  return useMemo<AppShellData>(
    () => ({
      uiDict,
      locale,
      sessionUserId,
      isSharedContext,
      canUseGlobalQuickActions,
      openQuickActions,
      reportingCurrency,
      saveReportingCurrency,
      isReportingCurrencySaving,
      reportingCurrencyError,
      transactionSubmission,
      mutations,
      recomputeAction,
      openRecomputeConfirm,
      transactionAccountOptions,
      accounts,
      feeProfiles,
      feeProfileBindings,
      refreshPortfolioConfig,
      isPortfolioConfigLoading,
      integrityIssue,
      showIntegrityDialog,
      setShowIntegrityDialog,
      generateSnapshots,
      isGeneratingSnapshots,
      contextRefreshSignal,
    }),
    [
      accounts,
      canUseGlobalQuickActions,
      contextRefreshSignal,
      feeProfileBindings,
      feeProfiles,
      generateSnapshots,
      integrityIssue,
      isReportingCurrencySaving,
      isGeneratingSnapshots,
      isPortfolioConfigLoading,
      isSharedContext,
      locale,
      mutations,
      openQuickActions,
      openRecomputeConfirm,
      recomputeAction,
      reportingCurrency,
      reportingCurrencyError,
      refreshPortfolioConfig,
      saveReportingCurrency,
      sessionUserId,
      setShowIntegrityDialog,
      showIntegrityDialog,
      transactionAccountOptions,
      transactionSubmission,
      uiDict,
    ],
  );
}
