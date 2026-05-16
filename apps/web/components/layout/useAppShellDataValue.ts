"use client";

import { useMemo } from "react";
import type { DashboardPerformanceRange, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import type {
  AppShellData,
  AppShellTransactionAccountOption,
} from "./AppShellDataContext";
import type { useDashboardData as useDashboardDataType } from "../../features/dashboard/hooks/useDashboardData";
import type { useTransactionSubmission as useTransactionSubmissionType } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { useTransactionMutations as useTransactionMutationsType } from "../../features/portfolio/hooks/useTransactionMutations";
import type { useRecomputeAction as useRecomputeActionType } from "../../features/portfolio/hooks/useRecomputeAction";

interface BuildAppShellDataValueOptions {
  dashboard: ReturnType<typeof useDashboardDataType>;
  uiDict: AppDictionary;
  locale: LocaleCode;
  isSharedContext: boolean;
  isI18nReady: boolean;
  transactionSubmission: ReturnType<typeof useTransactionSubmissionType>;
  mutations: ReturnType<typeof useTransactionMutationsType>;
  recomputeAction: ReturnType<typeof useRecomputeActionType>;
  transactionAccountOptions: AppShellTransactionAccountOption[];
  performanceRange: DashboardPerformanceRange;
  setPerformanceRange: (range: DashboardPerformanceRange) => void;
  effectiveRanges: DashboardPerformanceRange[];
  refetchEffectiveRanges: () => void;
  customizeRangesOpen: boolean;
  setCustomizeRangesOpen: (open: boolean) => void;
  generateSnapshots: () => Promise<void>;
  isGeneratingSnapshots: boolean;
  setDrawerOpen: (open: boolean) => void;
  contextRefreshSignal: number;
}

/**
 * Builds the memoized `AppShellData` provider value consumed by every page
 * via `useAppShellData()`. Extracted from `AppShell.tsx` per Phase 3c spec
 * target (AppShell ≤300 LOC).
 */
export function useAppShellDataValue(options: BuildAppShellDataValueOptions): AppShellData {
  const {
    dashboard,
    uiDict,
    locale,
    isSharedContext,
    isI18nReady,
    transactionSubmission,
    mutations,
    recomputeAction,
    transactionAccountOptions,
    performanceRange,
    setPerformanceRange,
    effectiveRanges,
    refetchEffectiveRanges,
    customizeRangesOpen,
    setCustomizeRangesOpen,
    generateSnapshots,
    isGeneratingSnapshots,
    setDrawerOpen,
    contextRefreshSignal,
  } = options;

  return useMemo<AppShellData>(
    () => ({
      dashboard,
      uiDict,
      locale,
      isSharedContext,
      isBootstrapping: dashboard.isBootstrapping,
      isI18nReady,
      transactionSubmission,
      mutations,
      recomputeAction,
      transactionAccountOptions,
      performanceRange,
      setPerformanceRange,
      effectiveRanges,
      refetchEffectiveRanges,
      customizeRangesOpen,
      setCustomizeRangesOpen,
      generateSnapshots,
      isGeneratingSnapshots,
      setDrawerOpen,
      contextRefreshSignal,
    }),
    [
      contextRefreshSignal,
      customizeRangesOpen,
      dashboard,
      effectiveRanges,
      generateSnapshots,
      isGeneratingSnapshots,
      isI18nReady,
      isSharedContext,
      locale,
      mutations,
      performanceRange,
      recomputeAction,
      refetchEffectiveRanges,
      setCustomizeRangesOpen,
      setDrawerOpen,
      setPerformanceRange,
      transactionAccountOptions,
      transactionSubmission,
      uiDict,
    ],
  );
}
