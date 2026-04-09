import { randomUUID } from "node:crypto";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";
import type { DividendCalendarPage } from "../../pages/dividends/DividendCalendarPage.js";

interface SeedDividendEventOptions {
  accountId?: string;
  ticker?: string;
  eventType?: "CASH" | "STOCK" | "CASH_AND_STOCK";
  exDividendDate: string;
  paymentDate?: string | null;
  cashDividendPerShare?: number;
  cashDividendCurrency?: string;
  stockDividendPerShare?: number;
  eligibleQuantity?: number;
}

interface SeedPostedDividendOptions extends SeedDividendEventOptions {
  receivedCashAmount?: number;
  receivedStockQuantity?: number;
  sourceCompositionStatus?: "provided" | "unknown_pending_disclosure";
  deductions?: Array<Record<string, unknown>>;
  sourceLines?: Array<Record<string, unknown>>;
}

function defaultPostingPayload(
  dividendEventId: string,
  overrides: SeedPostedDividendOptions,
): Record<string, unknown> {
  const receivedCashAmount = overrides.receivedCashAmount ?? 108;
  const deductions = overrides.deductions ?? [
    {
      deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
      amount: 12,
      currencyCode: "TWD",
      withheldAtSource: true,
      source: "dividend_posting",
    },
  ];
  const sourceCompositionStatus = overrides.sourceCompositionStatus ?? "provided";
  const sourceLines = overrides.sourceLines ?? [
    {
      sourceBucket: "DIVIDEND_INCOME",
      amount: receivedCashAmount + Number((deductions[0] as { amount?: number }).amount ?? 0),
      currencyCode: "TWD",
      source: "issuer_statement",
    },
  ];

  return {
    accountId: overrides.accountId ?? "acc-1",
    dividendEventId,
    receivedCashAmount,
    receivedStockQuantity: overrides.receivedStockQuantity ?? 0,
    deductions,
    sourceCompositionStatus,
    sourceLines: sourceCompositionStatus === "provided" ? sourceLines : [],
  };
}

export class DividendsArrange extends BaseArrange {
  declare protected readonly _instance: DividendCalendarPage;

  @Step()
  async seedDividendEvent(options: SeedDividendEventOptions): Promise<Record<string, unknown>> {
    if (!this.userId) throw new Error("seedDividendEvent requires userId");

    const response = await this.request.post(apiUrl("/__e2e/seed-dividend-event"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      data: {
        accountId: options.accountId ?? "acc-1",
        ticker: options.ticker ?? "2330",
        eventType: options.eventType ?? "CASH",
        exDividendDate: options.exDividendDate,
        paymentDate: options.paymentDate ?? null,
        cashDividendPerShare: options.cashDividendPerShare ?? 0.12,
        cashDividendCurrency: options.cashDividendCurrency ?? "TWD",
        stockDividendPerShare: options.stockDividendPerShare ?? 0,
        eligibleQuantity: options.eligibleQuantity ?? 1_000,
      },
    });

    if (!response.ok()) {
      throw new Error(`seedDividendEvent failed: ${response.status()} ${await response.text()}`);
    }

    return await response.json() as Record<string, unknown>;
  }

  @Step()
  async seedPostedDividend(options: SeedPostedDividendOptions): Promise<{
    dividendEventId: string;
    dividendLedgerEntryId: string;
    version: number;
  }> {
    if (!this.userId) throw new Error("seedPostedDividend requires userId");

    const seedBody = await this.seedDividendEvent(options);
    const dividendEvent = seedBody.dividendEvent as Record<string, unknown> | undefined;
    const dividendEventId = String(dividendEvent?.id ?? "");
    if (!dividendEventId) {
      throw new Error("seedPostedDividend expected dividendEvent.id");
    }

    const response = await this.request.post(new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href, {
      headers: {
        "content-type": "application/json",
        "idempotency-key": `seed-dividend-${randomUUID()}`,
        "x-user-id": this.userId,
      },
      data: defaultPostingPayload(dividendEventId, options),
    });

    if (!response.ok()) {
      throw new Error(`seedPostedDividend failed: ${response.status()} ${await response.text()}`);
    }

    const body = await response.json() as { dividendLedgerEntry?: { id?: string; version?: number } };
    return {
      dividendEventId,
      dividendLedgerEntryId: String(body.dividendLedgerEntry?.id ?? ""),
      version: Number(body.dividendLedgerEntry?.version ?? 0),
    };
  }
}
