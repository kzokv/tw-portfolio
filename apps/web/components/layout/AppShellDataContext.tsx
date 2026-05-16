"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  AccountDefaultCurrency,
  AccountType,
  DashboardPerformanceRange,
  LocaleCode,
} from "@vakwen/shared-types";
import type { useDashboardData } from "../../features/dashboard/hooks/useDashboardData";
import type { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import type { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import type { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { getDictionary } from "../../lib/i18n";

export interface AppShellTransactionAccountOption {
  id: string;
  name: string;
  feeProfileName: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType?: AccountType;
}

export interface AppShellData {
  dashboard: ReturnType<typeof useDashboardData>;
  uiDict: ReturnType<typeof getDictionary>;
  locale: LocaleCode;
  isSharedContext: boolean;
  isBootstrapping: boolean;
  isI18nReady: boolean;
  transactionSubmission: ReturnType<typeof useTransactionSubmission>;
  mutations: ReturnType<typeof useTransactionMutations>;
  recomputeAction: ReturnType<typeof useRecomputeAction>;
  transactionAccountOptions: AppShellTransactionAccountOption[];
  // Dashboard performance state stays in AppShell (range-snap effect lives
  // there); DashboardClient consumes the value and feeds it into
  // useDashboardPerformance.
  performanceRange: DashboardPerformanceRange;
  setPerformanceRange: (range: DashboardPerformanceRange) => void;
  effectiveRanges: DashboardPerformanceRange[];
  refetchEffectiveRanges: () => void;
  customizeRangesOpen: boolean;
  setCustomizeRangesOpen: (open: boolean) => void;
  generateSnapshots: () => Promise<void>;
  isGeneratingSnapshots: boolean;
  // Bumped by AppShell whenever shared-context cookie changes (switcher
  // select, ?as= deep link, fallback revoke). DashboardClient /
  // TransactionsClient watch this and call their hook .refresh() so their
  // page-scoped data picks up the new owner without remount.
  contextRefreshSignal: number;
}

const AppShellDataCtx = createContext<AppShellData | null>(null);

export function AppShellDataProvider({
  value,
  children,
}: {
  value: AppShellData;
  children: ReactNode;
}) {
  return <AppShellDataCtx.Provider value={value}>{children}</AppShellDataCtx.Provider>;
}

export function useAppShellData(): AppShellData {
  const value = useContext(AppShellDataCtx);
  if (!value) {
    throw new Error("useAppShellData must be used inside <AppShellDataProvider>");
  }
  return value;
}

/**
 * Non-throwing variant — returns `null` outside the provider. Useful for
 * leaf chrome components (e.g. the Breadcrumb) that render inside BOTH the
 * user shell (with AppShellDataProvider) and the admin shell (without).
 */
export function useOptionalAppShellData(): AppShellData | null {
  return useContext(AppShellDataCtx);
}
