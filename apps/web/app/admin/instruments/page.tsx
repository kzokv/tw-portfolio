import type { AdminInstrumentsResponse } from "@tw-portfolio/shared-types";
import { getJson } from "../../../lib/api";
import { AdminInstrumentsClient } from "../../../components/admin/AdminInstrumentsClient";

export default async function AdminInstrumentsPage() {
  const data = await getJson<AdminInstrumentsResponse>(
    "/admin/instruments?marketCode=AU&page=1&limit=50",
  );

  return <AdminInstrumentsClient initialData={data} />;
}
