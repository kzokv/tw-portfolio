import type { AppConfigDto } from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";

export default async function AdminSettingsPage() {
  const initial = await getJson<AppConfigDto>("/admin/settings");

  return <AdminSettingsClient initial={initial} />;
}
