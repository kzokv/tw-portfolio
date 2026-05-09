"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { API_PUBLIC } from "../../lib/api";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { useProfile } from "../../features/profile/hooks/useProfile";
import { ApiClientErrorToast } from "../layout/ApiClientErrorToast";
import { ImpersonationBanner } from "../layout/ImpersonationBanner";
import { TopBar } from "../layout/TopBar";
import { AdminSidebar } from "./AdminSidebar";
import { cn } from "../../lib/utils";

interface AdminShellProps {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  email: string | null;
  role: string;
  initialProfile: ProfileWithImpersonationDto;
  children: React.ReactNode;
}

const ADMIN_TITLES: Record<string, string> = {
  "/admin/users": "Users",
  "/admin/invites": "Invites",
  "/admin/audit-log": "Audit Log",
  "/admin/providers": "Provider Health",
  "/admin/instruments": "Instruments",
  "/admin/settings": "Settings",
};

export function AdminShell({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  initialProfile,
  children,
}: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const [chromeHeight, setChromeHeight] = useState(0);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const profileData = useProfile(initialProfile);
  const impersonation = profileData.profile?.impersonation
    && profileData.profile.impersonation.active !== false
    ? profileData.profile.impersonation
    : null;

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    const element = chromeRef.current;
    if (!element) return;

    const updateHeight = () => {
      setChromeHeight(element.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [impersonation]);

  const refreshAdminShell = useCallback(async () => {
    router.refresh();
    await profileData.refresh();
  }, [profileData, router]);

  const title = Object.entries(ADMIN_TITLES).find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Admin";

  return (
    <div className="relative min-h-screen min-w-0 overflow-x-clip">
      <div ref={chromeRef} className="sticky top-0 z-30">
        <ImpersonationBanner impersonation={impersonation} onRefreshContext={refreshAdminShell} />
        <TopBar
          userId={userId}
          displayName={displayName}
          pictureUrl={pictureUrl}
          email={email}
          role={role}
          sharingLabel="Sharing"
          onToggleNavigation={() => setMobileNavOpen((c) => !c)}
          navigationOpen={mobileNavOpen}
          productName="Admin"
          title={title}
          titleTooltip="Administration panel"
          signOutLabel="Sign out"
          signOutHref={`${API_PUBLIC}/auth/logout`}
          searchPlaceholder="Search..."
          searchLabel="Search"
          searchEmptyLabel="No results"
          searchRoutesLabel="Pages"
          searchTickersLabel="Tickers"
          openSearchLabel="Open search"
          closeSearchLabel="Close search"
          openNavigationLabel="Open navigation"
          closeNavigationLabel="Close navigation"
          expandSidebarLabel="Expand sidebar"
          collapseSidebarLabel="Collapse sidebar"
          searchItems={[]}
          sticky={false}
          mobileSearchTop={chromeHeight}
        />
      </div>

      <div
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/38 transition-opacity lg:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[min(21rem,calc(100%-1.5rem))] p-3 transition-transform duration-200 lg:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-[110%]",
        )}
      >
        <AdminSidebar />
      </aside>

      <div className="relative mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8 xl:px-10 xl:py-10">
        <div className="grid items-start gap-6 lg:grid-cols-[18.75rem_minmax(0,1fr)] xl:gap-8">
          <div className="hidden lg:block">
            <AdminSidebar />
          </div>
          <main className="min-w-0" data-testid="admin-main">
            <ApiClientErrorToast />
            {children}
          </main>
        </div>
      </div>
      <div data-testid="app-shell-ready" />
      {isClientReady ? <div data-testid="app-shell-client-ready" /> : null}
    </div>
  );
}
