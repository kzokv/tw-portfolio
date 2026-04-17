import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import type { ProfileDto } from "@tw-portfolio/shared-types";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { AdminShell } from "../../components/admin/AdminShell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSession();

  const profile = await getJson<ProfileDto>("/profile");

  if (profile.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <AdminShell
      userId={profile.userId}
      displayName={profile.displayName}
      pictureUrl={profile.providerPictureUrl}
      email={profile.email}
      role={profile.role}
    >
      {children}
    </AdminShell>
  );
}
