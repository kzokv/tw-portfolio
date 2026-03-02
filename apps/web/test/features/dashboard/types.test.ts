import { describe, expect, it } from "vitest";
import { resolveTransactionDraftAccount } from "../../../features/dashboard/types";
import type { TransactionInput } from "../../../components/portfolio/types";

const transaction: TransactionInput = {
  accountId: "missing",
  symbol: "2330",
  quantity: 1,
  priceNtd: 100,
  tradeDate: "2026-01-01",
  type: "BUY",
  isDayTrade: false,
};

describe("resolveTransactionDraftAccount", () => {
  it("falls back to the first available account when the current one is missing", () => {
    const next = resolveTransactionDraftAccount(transaction, [
      { id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" },
    ]);

    expect(next.accountId).toBe("account-1");
  });

  it("preserves the selected account when it still exists", () => {
    const next = resolveTransactionDraftAccount({ ...transaction, accountId: "account-1" }, [
      { id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" },
    ]);

    expect(next.accountId).toBe("account-1");
  });
});
