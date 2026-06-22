"use client";

import type { ReactNode } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { useAppShellData } from "../layout/AppShellDataContext";
import { SettingsNav } from "./SettingsNav";
import { SettingsMobileNav } from "./SettingsMobileNav";

interface SettingsTwoPaneLayoutProps {
  dict: AppDictionary;
  children: ReactNode;
}

/**
 * Phase 3d S2 — two-pane shell for the `/settings/*` route family.
 *
 * Desktop (≥md): inner sidebar (`<SettingsNav>`) on the left, content slot
 * on the right.
 *
 * Mobile (<md): top dropdown (`<SettingsMobileNav>`) above the content
 * slot. The 4 nav entries come from the locked labels in `dict.settings`.
 *
 * Locked testid contract (architect-design.md §6.1):
 *   - `settings-layout` on the root flex container
 *   - `settings-nav` / `settings-nav-mobile` on the nav surfaces
 */
export function SettingsTwoPaneLayout({ dict, children }: SettingsTwoPaneLayoutProps) {
  const shellData = useAppShellData();
  const personalItems = [
    { slug: "profile" as const, label: dict.settings.tabProfile },
    { slug: "general" as const, label: dict.settings.tabGeneral },
    { slug: "accounts" as const, label: dict.settings.tabAccounts },
    { slug: "ai-connectors" as const, label: dict.settings.tabAiConnectors },
    { slug: "display" as const, label: dict.settings.tabDisplay },
    { slug: "tickers" as const, label: dict.settings.tabTickers },
  ];
  const sharedItems = [
    {
      slug: "accounts" as const,
      label: dict.settings.tabPortfolioAccounts,
      hidden: shellData.isSharedContext && !shellData.sharedContextPermissions.canManageAccounts,
    },
  ].filter((item) => !item.hidden).map(({ hidden: _hidden, ...item }) => item);
  const items = shellData.isSharedContext ? sharedItems : personalItems;

  return (
    <div
      data-testid="settings-layout"
      className="flex min-h-[calc(100vh-8rem)] flex-col md:flex-row md:gap-0"
    >
      {/* Desktop sidebar — ≥md */}
      <div className="hidden md:block">
        <SettingsNav items={items} />
      </div>

      {/* Mobile dropdown — <md */}
      <div className="mb-4 md:hidden">
        <SettingsMobileNav items={items} />
      </div>

      <main className="flex-1 px-1 py-1 md:px-6 md:py-2">
        {children}
      </main>
    </div>
  );
}
