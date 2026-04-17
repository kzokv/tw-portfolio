import type { ProfileDto } from "@tw-portfolio/shared-types";
import { getJson } from "../../../lib/api";
import { AdminUsersClient } from "../../../components/admin/AdminUsersClient";

export default async function AdminUsersPage() {
  const profile = await getJson<ProfileDto>("/profile");

  return (
    <AdminUsersClient
      currentUserId={profile.userId}
      currentUserEmail={profile.email}
    />
  );
}
