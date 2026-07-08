import { randomUUID } from "node:crypto";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";
import type { DividendReviewPage } from "../../pages/dividends/DividendReviewPage.js";

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
  tradeDate?: string;
}

interface SeedPostedDividendOptions extends SeedDividendEventOptions {
  receivedCashAmount?: number;
  receivedStockQuantity?: number;
  sourceCompositionStatus?: "provided" | "unknown_pending_disclosure";
  deductions?: Array<Record<string, unknown>>;
  sourceLines?: Array<Record<string, unknown>>;
}

interface SeedPostedDividendWithReconciliationOptions extends SeedPostedDividendOptions {
  reconciliationStatus?: "open" | "matched" | "explained" | "resolved";
  reconciliationNote?: string;
}

interface SeedResult {
  dividendEventId: string;
  dividendLedgerEntryId: string;
  version: number;
}

interface SeedExpectedResult {
  dividendEventId: string;
  expectedReviewRowId: string;
}

export class DividendReviewArrange extends BaseArrange {
  declare protected readonly _instance: DividendReviewPage;

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
        tradeDate: options.tradeDate,
      },
    });

    if (!response.ok()) {
      throw new Error(`seedDividendEvent failed: ${response.status()} ${await response.text()}`);
    }

    return await response.json() as Record<string, unknown>;
  }

  @Step()
  async seedExpectedDividend(options: SeedDividendEventOptions): Promise<SeedExpectedResult> {
    const seedBody = await this.seedDividendEvent(options);
    const accountId = String(seedBody.accountId ?? options.accountId ?? "acc-1");
    const dividendEvent = seedBody.dividendEvent as Record<string, unknown> | undefined;
    const dividendEventId = String(dividendEvent?.id ?? "");
    if (!dividendEventId) {
      throw new Error("seedExpectedDividend expected dividendEvent.id");
    }
    return {
      dividendEventId,
      expectedReviewRowId: `expected:${accountId}:${dividendEventId}`,
    };
  }

  @Step()
  async seedPostedDividend(options: SeedPostedDividendOptions): Promise<SeedResult> {
    if (!this.userId) throw new Error("seedPostedDividend requires userId");

    const seedBody = await this.seedDividendEvent(options);
    const dividendEvent = seedBody.dividendEvent as Record<string, unknown> | undefined;
    const dividendEventId = String(dividendEvent?.id ?? "");
    if (!dividendEventId) {
      throw new Error("seedPostedDividend expected dividendEvent.id");
    }

    const receivedCashAmount = options.receivedCashAmount ?? 108;

    const response = await this.request.post(new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href, {
      headers: {
        "content-type": "application/json",
        "idempotency-key": `seed-dividend-${randomUUID()}`,
        "x-user-id": this.userId,
      },
      data: {
        accountId: options.accountId ?? "acc-1",
        dividendEventId,
        receivedCashAmount,
        receivedStockQuantity: options.receivedStockQuantity ?? 0,
        deductions: options.deductions ?? [],
        sourceCompositionStatus: options.sourceCompositionStatus ?? "unknown_pending_disclosure",
        sourceLines: options.sourceLines ?? [],
      },
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

  @Step()
  async seedPostedDividendWithReconciliation(
    options: SeedPostedDividendWithReconciliationOptions,
  ): Promise<SeedResult> {
    if (!this.userId) throw new Error("seedPostedDividendWithReconciliation requires userId");

    const posted = await this.seedPostedDividend(options);
    const { reconciliationStatus = "open", reconciliationNote } = options;

    if (reconciliationStatus !== "open") {
      const patchUrl = new URL(
        `/portfolio/dividends/postings/${encodeURIComponent(posted.dividendLedgerEntryId)}/reconciliation`,
        TestEnv.apiBaseUrl,
      ).href;
      const response = await this.request.patch(patchUrl, {
        headers: {
          "content-type": "application/json",
          "x-user-id": this.userId,
        },
        data: {
          status: reconciliationStatus,
          note: reconciliationNote,
        },
      });
      if (!response.ok()) {
        throw new Error(
          `seedPostedDividendWithReconciliation PATCH failed: ${response.status()} ${await response.text()}`,
        );
      }
      const body = await response.json() as { ledgerEntry?: { version?: number } };
      const patchedVersion = body.ledgerEntry?.version;
      if (typeof patchedVersion === "number") {
        return { ...posted, version: patchedVersion };
      }
    }

    return posted;
  }

  /**
   * Seeds multiple posted dividends in sequence for pagination/chart tests.
   * Returns all seed results.
   */
  @Step()
  async seedMultiplePostedDividends(
    count: number,
    baseOptions: Omit<SeedPostedDividendOptions, "exDividendDate" | "paymentDate"> & {
      /** Generator for exDividendDate per index */
      exDividendDate?: (index: number) => string;
      /** Generator for paymentDate per index */
      paymentDate?: (index: number) => string;
    },
  ): Promise<SeedResult[]> {
    const results: SeedResult[] = [];
    for (let i = 0; i < count; i++) {
      const exDividendDate = baseOptions.exDividendDate?.(i) ?? isoDateForMonth(1 + i, 0);
      const paymentDate = baseOptions.paymentDate?.(i) ?? isoDateForMonth(15 + (i % 14), 0);
      const result = await this.seedPostedDividend({
        ...baseOptions,
        exDividendDate,
        paymentDate,
      });
      results.push(result);
    }
    return results;
  }

  /**
   * PATCHes the reconciliation status on an existing ledger entry via API.
   * Used in SSE tests to trigger in-place updates.
   */
  @Step()
  async patchReconciliationViaApi(
    dividendLedgerEntryId: string,
    status: "open" | "matched" | "explained" | "resolved",
    note?: string,
  ): Promise<void> {
    if (!this.userId) throw new Error("patchReconciliationViaApi requires userId");

    const patchUrl = new URL(
      `/portfolio/dividends/postings/${encodeURIComponent(dividendLedgerEntryId)}/reconciliation`,
      TestEnv.apiBaseUrl,
    ).href;
    const response = await this.request.patch(patchUrl, {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      data: { status, note },
    });
    if (!response.ok()) {
      throw new Error(`patchReconciliationViaApi failed: ${response.status()} ${await response.text()}`);
    }
  }
}

function isoDateForMonth(day: number, monthOffset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day))
    .toISOString()
    .slice(0, 10);
}
