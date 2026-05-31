import type { AdminProvidersResponse } from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import { AdminProvidersClient } from "../../../components/admin/AdminProvidersClient";

export default async function AdminProvidersPage() {
  const data = await getJson<AdminProvidersResponse>("/admin/providers");

  return <AdminProvidersClient providers={data.providers} />;
}
