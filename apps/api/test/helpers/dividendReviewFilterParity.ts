import type {
  DividendCashReconciliationStatus,
  DividendStockReconciliationStatus,
} from "@vakwen/shared-types";

export const dividendReviewFilterParity = {
  cashStatuses: ["open", "matched"] satisfies DividendCashReconciliationStatus[],
  stockStatuses: ["matched", "variance"] satisfies DividendStockReconciliationStatus[],
  expectedRowSuffixes: ["a", "b", "c"],
} as const;
