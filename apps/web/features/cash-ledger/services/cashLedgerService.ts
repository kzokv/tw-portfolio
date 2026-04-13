import { getJson } from "../../../lib/api";
import type { CashLedgerListResponse, CashLedgerQuery } from "../types";

export async function fetchCashLedgerEntries(
  query: CashLedgerQuery = {},
): Promise<CashLedgerListResponse> {
  const params = new URLSearchParams();

  if (query.fromEntryDate) params.set("fromEntryDate", query.fromEntryDate);
  if (query.toEntryDate) params.set("toEntryDate", query.toEntryDate);
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.entryType) {
    for (const t of query.entryType) {
      params.append("entryType", t);
    }
  }
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);

  const qs = params.toString();
  return getJson<CashLedgerListResponse>(`/portfolio/cash-ledger${qs ? `?${qs}` : ""}`);
}
