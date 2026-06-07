import type {
  AdminAuditLogResponse,
  AdminInviteListResponse,
  AdminMarketDataLandingResponse,
  AdminUserListResponse,
} from "@vakwen/shared-types";
import { getJson } from "../../lib/api";
import { AdminOverviewClient } from "../../components/admin/AdminOverviewClient";

export default async function AdminPage() {
  const [users, invites, marketData, activity] = await Promise.all([
    getJson<AdminUserListResponse>("/admin/users?page=1&limit=1&status=active"),
    getJson<AdminInviteListResponse>("/admin/invites?page=1&limit=1&status=pending"),
    getJson<AdminMarketDataLandingResponse>("/admin/market-data"),
    getJson<AdminAuditLogResponse>("/admin/audit-log?page=1&limit=5"),
  ]);

  const lastUpdatedAt = [
    ...marketData.markets.flatMap((market) => market.latestOperation ? [market.latestOperation.updatedAt] : []),
    ...activity.items.map((entry) => entry.createdAt),
  ].sort().at(-1) ?? new Date().toISOString();

  return (
    <AdminOverviewClient
      activeUsers={users.total}
      pendingInvites={invites.total}
      markets={marketData.markets}
      recentActivity={activity.items}
      lastUpdatedAt={lastUpdatedAt}
    />
  );
}
