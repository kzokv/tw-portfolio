"use client";

import { useCallback, useEffect, useState } from "react";
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

interface AdminShellProps {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  email: string | null;
  role: string;
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
  initialProfile,
  initialSidebarOpen = true,
  children,
}: AdminShellProps) {
  const router = useRouter();
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
    <div className="flex min-h-screen flex-col">
      {/* Preserves §8 item 6 — ImpersonationBanner above SidebarProvider. */}
      <ImpersonationBanner impersonation={impersonation} onRefreshContext={refreshAdminShell} />

      <BreadcrumbProvider>
        <SidebarProvider defaultOpen={initialSidebarOpen}>
          <AppSidebar variant="admin" role={role} productName="Vakwen" />

          <SidebarInset className="relative min-w-0">
            <TopBar
              userId={userId}
              displayName={displayName}
              pictureUrl={pictureUrl}
              email={email}
              role={role}
              signOutHref={`${API_PUBLIC}/auth/logout`}
              searchPlaceholder="Search..."
              searchLabel="Search"
              searchEmptyLabel="No results"
              searchRoutesLabel="Pages"
              searchTickersLabel="Tickers"
              openSearchLabel="Open search"
              closeSearchLabel="Close search"
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
  );
}
