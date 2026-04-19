import type { ReactNode } from "react";
import type { LocaleCode, UserSettings } from "@tw-portfolio/shared-types";
import { getJson } from "../../lib/api";
import { requireSession } from "../../lib/auth";
import { SharingRouteProvider } from "../../components/sharing/SharingRouteProvider";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function SharingLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const profile = await getJson<ProfileWithImpersonationDto>("/profile");

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
      }}
    >
      {children}
    </SharingRouteProvider>
  );
}
