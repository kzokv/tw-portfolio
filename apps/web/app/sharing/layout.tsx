import type { ReactNode } from "react";
import type { LocaleCode, ProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import { getJson } from "../../lib/api";
import { requireSession } from "../../lib/auth";
import { SharingRouteProvider } from "../../components/sharing/SharingRouteProvider";

export default async function SharingLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const profile = await getJson<ProfileDto>("/profile");

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
        profile: {
          userId: profile.userId,
          email: profile.email,
          displayName: profile.displayName,
          role: profile.role,
        },
      }}
    >
      {children}
    </SharingRouteProvider>
  );
}
