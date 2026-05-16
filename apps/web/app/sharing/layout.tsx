import type { ReactNode } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { getJson } from "../../lib/api";
import { requireSession } from "../../lib/auth";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { SharingRouteProvider } from "../../components/sharing/SharingRouteProvider";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function SharingLayout({ children }: { children: ReactNode }) {
  const [session, profile, initialSidebarOpen] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);

  let locale: LocaleCode = "en";
  try {
    const settings = await getJson<UserSettings>("/settings");
    locale = settings.locale;
  } catch {
    locale = "en";
  }

  return (
    <SharingRouteProvider
      value={{
        isDemo: session.isDemo,
        locale,
        profile,
        initialSidebarOpen,
      }}
    >
      {children}
    </SharingRouteProvider>
  );
}
