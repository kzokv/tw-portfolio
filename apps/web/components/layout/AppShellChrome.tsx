"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { type LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { CardLayoutResetProvider } from "./CardLayoutResetContext";
import { IntegrityIssueDialog } from "../../features/dashboard/components/IntegrityIssueDialog";
import type {
  useDashboardData as useDashboardDataType,
} from "../../features/dashboard/hooks/useDashboardData";

type DashboardData = ReturnType<typeof useDashboardDataType>;

interface AppShellChromeProps {
  dashboard: DashboardData;
  /** Locale-aware dictionary used by the integrity dialog. */
  uiDict: AppDictionary;
  locale: LocaleCode;
  /** The main page content; wrapped by `<CardLayoutResetProvider>`. */
  children: ReactNode;
}

/**
 * Chrome bundle for AppShell: IntegrityIssueDialog + the card-layout reset
 * wiring. Phase 3d S10 retired the embedded SettingsDrawer + its supporting
 * state — settings now lives at `/settings/*` routes, and the integrity
 * dialog's "Open settings" CTA navigates instead of opening a drawer.
 */
export function AppShellChrome({
  dashboard,
  uiDict,
  locale: _locale,
  children,
}: AppShellChromeProps) {
  const router = useRouter();
  // KZO-161 (158C) F5 / KZO-162 — Per-page remount counter map.
  const [cardLayoutResetCounts] = useState<{
    dashboard: number;
    transactions: number;
    portfolio: number;
  }>({ dashboard: 0, transactions: 0, portfolio: 0 });

  const openSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  return (
    <>
      <CardLayoutResetProvider value={cardLayoutResetCounts}>
        {children}
      </CardLayoutResetProvider>

      <IntegrityIssueDialog
        issue={dashboard.actions.integrityIssue}
        open={dashboard.showIntegrityDialog}
        onOpenChange={dashboard.setShowIntegrityDialog}
        onOpenSettings={openSettings}
        dict={uiDict}
      />
    </>
  );
}
