import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../../components/layout/i18n";
import { UnrealizedPnlAnalysisClient } from "../../../components/analysis/UnrealizedPnlAnalysisClient";
import {
  applyAnalysisSettings,
  getExplicitAnalysisPreferenceKeys,
  parseAnalysisSettingsFromPreferences,
  parseUnrealizedPnlRouteState,
} from "../../../features/analysis/unrealizedPnlRouteState";
import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";

interface UnrealizedPnlPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface UserPreferencesResponse {
  preferences?: Record<string, unknown>;
}

export default async function UnrealizedPnlPage({ searchParams }: UnrealizedPnlPageProps) {
  const rawSearchParams = await searchParams;
  const parsedState = parseUnrealizedPnlRouteState(rawSearchParams);
  const explicitPreferenceKeys = getExplicitAnalysisPreferenceKeys(rawSearchParams);
  const [session, profile, sidebarOpen, settings, preferences] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" }).catch(() => null),
  ]);
  const initialSettings = parseAnalysisSettingsFromPreferences(preferences?.preferences);
  const initialState = applyAnalysisSettings(parsedState, initialSettings, explicitPreferenceKeys);
  const locale = settings?.locale ?? "en";
  const loadingCopy = getRouteLoadingLabels(locale).analysis;

  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="analysis"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialSettings={settings}
        initialSidebarOpen={sidebarOpen}
        portfolioConfigMode="lazy"
      >
        <UnrealizedPnlAnalysisClient
          explicitPreferenceKeys={explicitPreferenceKeys}
          initialData={null}
          initialState={initialState}
          locale={locale}
        />
      </AppShell>
    </Suspense>
  );
}
