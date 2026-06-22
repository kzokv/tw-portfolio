import { getJson } from "../../../lib/api";
import { AdminUsersClient } from "../../../components/admin/AdminUsersClient";
import type { ProfileWithImpersonationDto } from "../../../features/profile/hooks/useProfile";

export default async function AdminUsersPage() {
  const profile = await getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" });

  return (
    <AdminUsersClient
      currentUserId={profile.userId}
      currentUserEmail={profile.email}
    />
  );
}
