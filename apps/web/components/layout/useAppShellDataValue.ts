"use client";

import { useMemo } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
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
  isSharedContext: boolean;
  transactionSubmission: ReturnType<typeof useTransactionSubmissionType>;
  mutations: ReturnType<typeof useTransactionMutationsType>;
  recomputeAction: ReturnType<typeof useRecomputeActionType>;
  openRecomputeConfirm: () => void;
  transactionAccountOptions: AppShellTransactionAccountOption[];
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
    isSharedContext,
    transactionSubmission,
    mutations,
    recomputeAction,
    openRecomputeConfirm,
    transactionAccountOptions,
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
      isSharedContext,
      transactionSubmission,
      mutations,
      recomputeAction,
      openRecomputeConfirm,
      transactionAccountOptions,
      integrityIssue,
      showIntegrityDialog,
      setShowIntegrityDialog,
      generateSnapshots,
      isGeneratingSnapshots,
      contextRefreshSignal,
    }),
    [
      contextRefreshSignal,
      generateSnapshots,
      integrityIssue,
      isGeneratingSnapshots,
      isSharedContext,
      locale,
      mutations,
      openRecomputeConfirm,
      recomputeAction,
      setShowIntegrityDialog,
      showIntegrityDialog,
      transactionAccountOptions,
      transactionSubmission,
      uiDict,
    ],
  );
}
