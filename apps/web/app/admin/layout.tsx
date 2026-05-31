import type { ReactNode } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { AdminShell } from "../../components/admin/AdminShell";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSession();

  const [profile, sidebarOpen] = await Promise.all([
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
  ]);

  if (profile.role !== "admin") {
    redirect("/dashboard");
  }

  let locale: LocaleCode = "en";
  try {
    const settings = await getJson<UserSettings>("/settings");
    locale = settings.locale;
  } catch {
    locale = "en";
  }

  return (
    <AdminShell
      userId={profile.userId}
      displayName={profile.displayName}
      pictureUrl={profile.providerPictureUrl}
      email={profile.email}
      role={profile.role}
      locale={locale}
      initialProfile={profile}
      initialSidebarOpen={sidebarOpen}
    >
      {children}
    </AdminShell>
  );
}
