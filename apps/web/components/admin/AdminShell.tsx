"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import { useRouter } from "next/navigation";
import { API_PUBLIC } from "../../lib/api";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { useProfile } from "../../features/profile/hooks/useProfile";
import { ApiClientErrorToast } from "../layout/ApiClientErrorToast";
import { ImpersonationBanner } from "../layout/ImpersonationBanner";
import { TopBar } from "../layout/TopBar";
import { AppSidebar } from "../layout/AppSidebar";
import { BreadcrumbProvider } from "../layout/BreadcrumbProvider";
import { SidebarInset, SidebarProvider } from "../ui/shadcn/sidebar";
import { AdminI18nProvider, adminI18n } from "./admin-i18n";

interface AdminShellProps {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  email: string | null;
  role: string;
  locale: LocaleCode;
  initialProfile: ProfileWithImpersonationDto;
  /** SSR-resolved sidebar collapsed state (Preserves §8 item 14). */
  initialSidebarOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Admin shell — mirrors AppShell with `AppSidebar variant="admin"` for the
 * warning rail (Preserves §8 item 15). No portfolio switcher, no search, no
 * notification bell. Theme toggle + profile menu still render in TopBar.
 */
export function AdminShell({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  locale,
  initialProfile,
  initialSidebarOpen = true,
  children,
}: AdminShellProps) {
  const router = useRouter();
  const dict = adminI18n[locale === "zh-TW" ? "zh-TW" : "en"];
  const [isClientReady, setIsClientReady] = useState(false);
  const profileData = useProfile(initialProfile);
  const impersonation = profileData.profile?.impersonation
    && profileData.profile.impersonation.active !== false
    ? profileData.profile.impersonation
    : null;

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  const refreshAdminShell = useCallback(async () => {
    router.refresh();
    await profileData.refresh();
  }, [profileData, router]);

  return (
    <AdminI18nProvider locale={locale}>
    <div className="flex min-h-screen flex-col">
      {/* Preserves §8 item 6 — ImpersonationBanner above SidebarProvider. */}
      <ImpersonationBanner impersonation={impersonation} onRefreshContext={refreshAdminShell} />

      <BreadcrumbProvider>
        <SidebarProvider defaultOpen={initialSidebarOpen}>
          <AppSidebar
            variant="admin"
            role={role}
            productName="Vakwen"
            labels={{
              productSubtitle: dict.shell.productSubtitle,
              management: dict.shell.management,
              brandMobileAria: dict.shell.brandMobileAria,
              brandDesktopAria: dict.shell.brandDesktopAria,
              backToApp: dict.shell.backToApp,
              dashboardFeedbackLabel: dict.shell.dashboard,
              nav: {
                overview: dict.shell.nav.overview,
                users: dict.shell.nav.users,
                invites: dict.shell.nav.invites,
                "audit-log": dict.shell.nav.auditLog,
                "market-data": "Market Data",
                settings: dict.shell.nav.settings,
              },
            }}
          />

          <SidebarInset className="relative min-w-0">
            <TopBar
              userId={userId}
              displayName={displayName}
              pictureUrl={pictureUrl}
              email={email}
              role={role}
              signOutHref={`${API_PUBLIC}/auth/logout`}
              searchPlaceholder={dict.shell.searchPlaceholder}
              searchLabel={dict.shell.searchLabel}
              searchEmptyLabel={dict.shell.searchEmptyLabel}
              searchRoutesLabel={dict.shell.searchRoutesLabel}
              searchTickersLabel={dict.shell.searchTickersLabel}
              openSearchLabel={dict.shell.openSearchLabel}
              closeSearchLabel={dict.shell.closeSearchLabel}
              searchItems={[]}
              hideSearch
              hideNotifications
            />

            <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8" data-testid="admin-main">
              <ApiClientErrorToast />
              {children}
              <div data-testid="app-shell-ready" />
              {isClientReady ? <div data-testid="app-shell-client-ready" /> : null}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </BreadcrumbProvider>
    </div>
    </AdminI18nProvider>
  );
}
