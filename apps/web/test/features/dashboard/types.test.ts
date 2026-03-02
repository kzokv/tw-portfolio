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
    const previous = { ...transaction, accountId: "account-1" };
    const next = resolveTransactionDraftAccount(previous, [
      { id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" },
    ]);

    expect(next).toBe(previous);
    expect(next.accountId).toBe("account-1");
  });

  it("returns the same object when there are no accounts and nothing changes", () => {
    const previous = { ...transaction, accountId: "" };
    const next = resolveTransactionDraftAccount(previous, []);

    expect(next).toBe(previous);
    expect(next.accountId).toBe("");
  });
});
