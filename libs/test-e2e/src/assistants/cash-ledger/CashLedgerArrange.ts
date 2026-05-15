import { randomUUID } from "node:crypto";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";
import type { CashLedgerPage } from "../../pages/cash-ledger/CashLedgerPage.js";

export class CashLedgerArrange extends BaseArrange {
  declare protected readonly _instance: CashLedgerPage;

  @Step()
  async seedTradeWithSettlement(overrides: {
    ticker?: string;
    marketCode?: "TW" | "US" | "AU";
    type?: "BUY" | "SELL";
    quantity?: number;
    unitPrice?: number;
    tradeDate?: string;
    commissionAmount?: number;
    taxAmount?: number;
  } = {}): Promise<Record<string, unknown>> {
    if (!this.userId) throw new Error("seedTradeWithSettlement requires userId");

    const response = await this.request.post(
      new URL("/portfolio/transactions", TestEnv.apiBaseUrl).href,
      {
        headers: {
          "content-type": "application/json",
          "idempotency-key": `seed-trade-${randomUUID()}`,
          "x-user-id": this.userId,
        },
        data: {
          accountId: "acc-1",
          ticker: overrides.ticker ?? "2330",
          marketCode: overrides.marketCode ?? "TW",
          type: overrides.type ?? "BUY",
          quantity: overrides.quantity ?? 10,
          unitPrice: overrides.unitPrice ?? 100,
          priceCurrency: "TWD",
          tradeDate: overrides.tradeDate ?? "2026-01-15",
          isDayTrade: false,
          commissionAmount: overrides.commissionAmount ?? 0,
          taxAmount: overrides.taxAmount ?? 0,
        },
      },
    );

    if (!response.ok()) {
      throw new Error(`seedTradeWithSettlement failed: ${response.status()} ${await response.text()}`);
    }

    return await response.json() as Record<string, unknown>;
  }

  @Step()
  async seedDividendWithCashEntry(overrides: {
    ticker?: string;
    exDividendDate?: string;
    paymentDate?: string;
    cashDividendPerShare?: number;
    receivedCashAmount?: number;
    eligibleQuantity?: number;
  } = {}): Promise<{
    dividendEventId: string;
    dividendLedgerEntryId: string;
  }> {
    if (!this.userId) throw new Error("seedDividendWithCashEntry requires userId");

    // Step 1: seed dividend event
    const seedResponse = await this.request.post(apiUrl("/__e2e/seed-dividend-event"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      data: {
        accountId: "acc-1",
        ticker: overrides.ticker ?? "2330",
        eventType: "CASH",
        exDividendDate: overrides.exDividendDate ?? "2026-02-01",
        paymentDate: overrides.paymentDate ?? "2026-02-20",
        cashDividendPerShare: overrides.cashDividendPerShare ?? 12,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        eligibleQuantity: overrides.eligibleQuantity ?? 1_000,
      },
    });

    if (!seedResponse.ok()) {
      throw new Error(`seedDividendEvent failed: ${seedResponse.status()} ${await seedResponse.text()}`);
    }

    const seedBody = await seedResponse.json() as Record<string, unknown>;
    const dividendEvent = seedBody.dividendEvent as { id?: string } | undefined;
    const dividendEventId = String(dividendEvent?.id ?? "");
    if (!dividendEventId) {
      throw new Error("seedDividendWithCashEntry expected dividendEvent.id");
    }

    // Step 2: post dividend (creates cash ledger entries)
    const receivedCashAmount = overrides.receivedCashAmount ?? 10800;
    const postResponse = await this.request.post(
      new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href,
      {
        headers: {
          "content-type": "application/json",
          "idempotency-key": `seed-dividend-${randomUUID()}`,
          "x-user-id": this.userId,
        },
        data: {
          accountId: "acc-1",
          dividendEventId,
          receivedCashAmount,
          receivedStockQuantity: 0,
          deductions: [],
          sourceCompositionStatus: "unknown_pending_disclosure",
          sourceLines: [],
        },
      },
    );

    if (!postResponse.ok()) {
      throw new Error(`postDividend failed: ${postResponse.status()} ${await postResponse.text()}`);
    }

    const postBody = await postResponse.json() as { dividendLedgerEntry?: { id?: string } };
    return {
      dividendEventId,
      dividendLedgerEntryId: String(postBody.dividendLedgerEntry?.id ?? ""),
    };
  }
}
