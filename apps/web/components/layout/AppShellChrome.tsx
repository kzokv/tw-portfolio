"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  type AccountDefaultCurrency,
  type LocaleCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { CardLayoutResetProvider } from "./CardLayoutResetContext";
import { IntegrityIssueDialog } from "../../features/dashboard/components/IntegrityIssueDialog";
import { SettingsDrawer } from "../settings/SettingsDrawer";
import { useSettingsSave } from "../../features/settings/hooks/useSettingsSave";
import { renameAccount } from "../../features/settings/services/settingsService";
import type {
  useDashboardData as useDashboardDataType,
} from "../../features/dashboard/hooks/useDashboardData";
import type { useProfile as useProfileType } from "../../features/profile/hooks/useProfile";

type DashboardData = ReturnType<typeof useDashboardDataType>;
type ProfileData = ReturnType<typeof useProfileType>;

type SettingsTab = "profile" | "general" | "accounts" | "tickers" | "display";

interface AppShellChromeProps {
  /** Settings drawer open state — URL-derived, owned by AppShell. */
  drawerOpen: boolean;
  /** Setter for the URL-derived drawer state. */
  onDrawerOpenChange: (open: boolean) => void;
  /** Resolved initial tab from `?settingsTab=…`. */
  settingsInitialTab?: SettingsTab;
  /** Resolved currency prefill from `?accountsPrefillCurrency=…`. */
  accountsPrefillCurrency?: AccountDefaultCurrency;
  dashboard: DashboardData;
  profileData: ProfileData;
  /** Locale-aware dictionary used by the drawer + integrity dialog. */
  uiDict: AppDictionary;
  locale: LocaleCode;
  /** KZO-161 — refresh effective performance ranges after Timeframes save. */
  onTimeframesSaved: () => void;
  /** KZO-180 — refresh dashboard + bump context refresh after currency save. */
  onReportingCurrencySaved: () => void;
  /** The main page content; wrapped by `<CardLayoutResetProvider>`. */
  children: ReactNode;
}

/**
 * Chrome bundle for AppShell: SettingsDrawer + IntegrityIssueDialog + the
 * card-layout reset wiring. Owns the supporting state/hooks (cardLayoutReset
 * counts, useSettingsSave, transactionAccountOptions, handleRenameAccount).
 *
 * Extracted from AppShell.tsx per Phase 3c spec target (AppShell ≤300 LOC).
 * Both rendered Radix surfaces portal to `document.body`, so nesting them
 * inside `<main>` is positionally equivalent to the prior root-level render.
 */
export function AppShellChrome({
  drawerOpen,
  onDrawerOpenChange,
  settingsInitialTab,
  accountsPrefillCurrency,
  dashboard,
  profileData,
  uiDict,
  locale: _locale,
  onTimeframesSaved,
  onReportingCurrencySaved,
  children,
}: AppShellChromeProps) {
  // KZO-161 (158C) F5 / KZO-162 — Per-page remount counter map.
  const [cardLayoutResetCounts, setCardLayoutResetCounts] = useState<{
    dashboard: number;
    transactions: number;
    portfolio: number;
  }>({ dashboard: 0, transactions: 0, portfolio: 0 });

  const settingsSave = useSettingsSave({
    refresh: dashboard.refresh,
    closeDrawer: () => onDrawerOpenChange(false),
  });

  const handleRenameAccount = useCallback(
    async (accountId: string, name: string) => {
      await renameAccount(accountId, name);
      await dashboard.refresh();
    },
    [dashboard],
  );

  const handleLayoutReset = useCallback(() => {
    setCardLayoutResetCounts((counts) => ({
      dashboard: counts.dashboard + 1,
      transactions: counts.transactions + 1,
      portfolio: counts.portfolio + 1,
    }));
  }, []);

  const handlePageLayoutReset = useCallback(
    (page: "dashboard" | "transactions" | "portfolio") => {
      setCardLayoutResetCounts((counts) => ({
        ...counts,
        [page]: counts[page] + 1,
      }));
    },
    [],
  );

  const openDrawer = useCallback(() => onDrawerOpenChange(true), [onDrawerOpenChange]);

  return (
    <>
      <CardLayoutResetProvider value={cardLayoutResetCounts}>
        {children}
      </CardLayoutResetProvider>

      <IntegrityIssueDialog
        issue={dashboard.actions.integrityIssue}
        open={dashboard.showIntegrityDialog}
        onOpenChange={dashboard.setShowIntegrityDialog}
        onOpenSettings={openDrawer}
        dict={uiDict}
      />

      <SettingsDrawer
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
        settings={dashboard.settings}
        accounts={dashboard.accounts}
        feeProfiles={dashboard.feeProfiles}
        feeProfileBindings={dashboard.feeProfileBindings}
        profile={profileData.profile}
        onProfileUpdate={profileData.refresh}
        onAccountsRefresh={dashboard.refresh}
        isSaving={settingsSave.isSaving}
        errorMessage={settingsSave.errorMessage}
        onSave={settingsSave.save}
        onRenameAccount={handleRenameAccount}
        dict={uiDict}
        onTimeframesSaved={onTimeframesSaved}
        onLayoutReset={handleLayoutReset}
        onPageLayoutReset={handlePageLayoutReset}
        onReportingCurrencySaved={onReportingCurrencySaved}
        initialTab={settingsInitialTab}
        accountsPrefillCurrency={accountsPrefillCurrency}
      />
    </>
  );
}
