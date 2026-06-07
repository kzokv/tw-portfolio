import type { AdminMarketDataLandingResponse } from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import { AdminMarketDataLandingClient } from "../../../components/admin/AdminMarketDataClient";

export default async function AdminMarketDataPage() {
  const data = await getJson<AdminMarketDataLandingResponse>("/admin/market-data");
  return <AdminMarketDataLandingClient data={data} />;
}
