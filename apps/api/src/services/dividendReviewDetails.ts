import type { DividendReviewRowWithDetails } from "../persistence/types.js";
import type { Store } from "../types/store.js";
import { buildDividendLedgerEntryDetails } from "./dividends.js";

export function enrichDividendReviewRows(
  store: Store,
  rows: readonly DividendReviewRowWithDetails[],
): DividendReviewRowWithDetails[] {
  const ledgerRows = rows.filter((row) => row.rowKind === "ledger");
  if (ledgerRows.length === 0) return [...rows];

  const detailsById = new Map(
    buildDividendLedgerEntryDetails(store, ledgerRows, { preserveOrder: true })
      .map((row) => [row.id, row]),
  );

  return rows.map((row) => {
    const details = detailsById.get(row.id);
    return details ? { ...row, ...details, rowKind: row.rowKind } : row;
  });
}
