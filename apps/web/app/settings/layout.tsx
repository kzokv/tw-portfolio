import type { ReactNode } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { getJson } from "../../lib/api";
import { requireSession } from "../../lib/auth";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { SettingsRouteProvider } from "../../components/settings/SettingsRouteProvider";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

/**
 * Phase 3d S2 — server layout for `/settings/*`.
 *
 * Mirrors the `app/sharing/layout.tsx` pattern: `requireSession()` is the
 * first await (redirects to `/login` for anonymous visitors per
 * `lib/auth.ts`), then the profile + sidebar state + settings hydrate the
 * client provider.
 *
 * Settings fetch is `try/catch`-wrapped because a fresh user may not yet
 * have a settings row; the section clients tolerate `null`.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [session, profile, initialSidebarOpen] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);

  let locale: LocaleCode = "en";
  let initialSettings: UserSettings | null = null;
  try {
    initialSettings = await getJson<UserSettings>("/settings");
    locale = initialSettings.locale;
  } catch {
    locale = "en";
    initialSettings = null;
  }

  return (
    <SettingsRouteProvider
      value={{
        isDemo: session.isDemo,
        locale,
        profile,
        initialSidebarOpen,
        initialSettings,
      }}
    >
      {children}
    </SettingsRouteProvider>
  );
}
