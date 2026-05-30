import type {
  AdminAuditLogResponse,
  AdminInviteListResponse,
  AdminInstrumentsResponse,
  AdminProvidersResponse,
  AdminUserListResponse,
} from "@vakwen/shared-types";
import { getJson } from "../../lib/api";
import { AdminOverviewClient } from "../../components/admin/AdminOverviewClient";

export default async function AdminPage() {
  const [users, invites, providers, instruments, activity] = await Promise.all([
    getJson<AdminUserListResponse>("/admin/users?page=1&limit=1&status=active"),
    getJson<AdminInviteListResponse>("/admin/invites?page=1&limit=1&status=pending"),
    getJson<AdminProvidersResponse>("/admin/providers"),
    getJson<AdminInstrumentsResponse>("/admin/instruments?marketCode=AU&page=1&limit=1"),
    getJson<AdminAuditLogResponse>("/admin/audit-log?page=1&limit=5"),
  ]);

  const lastUpdatedAt = [
    ...providers.providers.map((provider) => provider.updatedAt),
    ...activity.items.map((entry) => entry.createdAt),
  ].sort().at(-1) ?? new Date().toISOString();

  return (
    <AdminOverviewClient
      activeUsers={users.total}
      pendingInvites={invites.total}
      instrumentCount={instruments.total}
      providers={providers.providers}
      recentActivity={activity.items}
      lastUpdatedAt={lastUpdatedAt}
    />
  );
}
