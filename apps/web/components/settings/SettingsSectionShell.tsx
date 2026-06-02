"use client";

import { useMemo, type ReactNode } from "react";
import { AppShell } from "../layout/AppShell";
import { getDictionary } from "../../lib/i18n";
import { SettingsTwoPaneLayout } from "./SettingsTwoPaneLayout";
import { useSettingsRouteContext } from "./SettingsRouteProvider";

interface SettingsSectionShellProps {
  children: ReactNode;
  portfolioConfigMode?: "eager" | "lazy";
}

/**
 * Phase 3d S2 — client wrapper that mounts `<AppShell>` (sidebar + topbar
 * chrome) around the settings two-pane layout. Each `/settings/{section}`
 * page composes this with its own section-specific client inside `children`.
 */
export function SettingsSectionShell({ children, portfolioConfigMode = "eager" }: SettingsSectionShellProps) {
  const { isDemo, locale, profile, initialSidebarOpen } = useSettingsRouteContext();
  const dict = useMemo(() => getDictionary(locale), [locale]);

  return (
    <AppShell
      isDemo={isDemo}
      localeOverride={locale}
      activeSectionOverride={null}
      initialProfile={profile}
      initialSidebarOpen={initialSidebarOpen}
      portfolioConfigMode={portfolioConfigMode}
    >
      <SettingsTwoPaneLayout dict={dict}>{children}</SettingsTwoPaneLayout>
    </AppShell>
  );
}
