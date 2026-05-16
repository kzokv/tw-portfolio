"use client";

import type { ReactNode } from "react";
import type { AppDictionary } from "../../lib/i18n";
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
  const labels = {
    profile: dict.settings.tabProfile,
    accounts: dict.settings.tabAccounts,
    display: dict.settings.tabDisplay,
    tickers: dict.settings.tabTickers,
  };

  return (
    <div
      data-testid="settings-layout"
      className="flex min-h-[calc(100vh-8rem)] flex-col md:flex-row md:gap-0"
    >
      {/* Desktop sidebar — ≥md */}
      <div className="hidden md:block">
        <SettingsNav labels={labels} />
      </div>

      {/* Mobile dropdown — <md */}
      <div className="mb-4 md:hidden">
        <SettingsMobileNav labels={labels} />
      </div>

      <main className="flex-1 px-1 py-1 md:px-6 md:py-2">
        {children}
      </main>
    </div>
  );
}
