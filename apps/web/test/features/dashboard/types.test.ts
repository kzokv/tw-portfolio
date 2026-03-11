import { describe, expect, it } from "vitest";
import { resolveTransactionDraftAccount } from "../../../features/dashboard/types";
import type { TransactionInput } from "../../../components/portfolio/types";

const transaction: TransactionInput = {
  accountId: "missing",
  symbol: "2330",
  quantity: 1,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-01-01",
  type: "BUY",
  isDayTrade: false,
};

describe("resolveTransactionDraftAccount", () => {
  it("falls back to the first available account when the current one is missing", () => {
    const next = resolveTransactionDraftAccount(transaction, [
      { id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" },
    ], [
      {
        id: "profile-1",
        name: "Default",
        boardCommissionRate: 1.425,
        commissionDiscountPercent: 60,
        minimumCommissionAmount: 20,
        commissionCurrency: "TWD",
        commissionRoundingMode: "FLOOR",
        taxRoundingMode: "FLOOR",
        stockSellTaxRateBps: 30,
        stockDayTradeTaxRateBps: 15,
        etfSellTaxRateBps: 10,
        bondEtfSellTaxRateBps: 0,
        commissionChargeMode: "CHARGED_UPFRONT",
      },
    ], []);

    expect(next.accountId).toBe("account-1");
    expect(next.priceCurrency).toBe("TWD");
  });

  it("preserves the selected account when it still exists", () => {
    const previous = { ...transaction, accountId: "account-1" };
    const next = resolveTransactionDraftAccount(previous, [
      { id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" },
    ], [
      {
        id: "profile-1",
        name: "Default",
        boardCommissionRate: 1.425,
        commissionDiscountPercent: 60,
        minimumCommissionAmount: 20,
        commissionCurrency: "TWD",
        commissionRoundingMode: "FLOOR",
        taxRoundingMode: "FLOOR",
        stockSellTaxRateBps: 30,
        stockDayTradeTaxRateBps: 15,
        etfSellTaxRateBps: 10,
        bondEtfSellTaxRateBps: 0,
        commissionChargeMode: "CHARGED_UPFRONT",
      },
    ], []);

    expect(next).toBe(previous);
    expect(next.accountId).toBe("account-1");
  });

  it("derives transaction currency from the effective bound fee profile", () => {
    const previous = { ...transaction, accountId: "account-1", symbol: "2330", priceCurrency: "TWD" };
    const next = resolveTransactionDraftAccount(
      previous,
      [{ id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" }],
      [
        {
          id: "profile-1",
          name: "Default",
          boardCommissionRate: 1.425,
          commissionDiscountPercent: 60,
          minimumCommissionAmount: 20,
          commissionCurrency: "TWD",
          commissionRoundingMode: "FLOOR",
          taxRoundingMode: "FLOOR",
          stockSellTaxRateBps: 30,
          stockDayTradeTaxRateBps: 15,
          etfSellTaxRateBps: 10,
          bondEtfSellTaxRateBps: 0,
          commissionChargeMode: "CHARGED_UPFRONT",
        },
        {
          id: "profile-2",
          name: "USD Override",
          boardCommissionRate: 1.425,
          commissionDiscountPercent: 60,
          minimumCommissionAmount: 20,
          commissionCurrency: "USD",
          commissionRoundingMode: "FLOOR",
          taxRoundingMode: "FLOOR",
          stockSellTaxRateBps: 30,
          stockDayTradeTaxRateBps: 15,
          etfSellTaxRateBps: 10,
          bondEtfSellTaxRateBps: 0,
          commissionChargeMode: "CHARGED_UPFRONT",
        },
      ],
      [{ accountId: "account-1", symbol: "2330", feeProfileId: "profile-2" }],
    );

    expect(next.priceCurrency).toBe("USD");
  });

  it("returns the same object when there are no accounts and nothing changes", () => {
    const previous = { ...transaction, accountId: "" };
    const next = resolveTransactionDraftAccount(previous, [], [], []);

    expect(next).toBe(previous);
    expect(next.accountId).toBe("");
  });
});
