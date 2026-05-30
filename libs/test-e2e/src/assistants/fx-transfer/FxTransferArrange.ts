import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";
import type { FxTransferPage } from "../../pages/fx-transfer/FxTransferPage.js";

export class FxTransferArrange extends BaseArrange {
  declare protected readonly _instance: FxTransferPage;

  /**
   * Seed direct mid rates for the FX-transfer specs. Each test reserves its
   * own date set per `e2e-shared-memory-bars-ticker-hygiene.md`-equivalent
   * hygiene for FX rates (scope-todo D17).
   */
  @Step()
  async seedFxRates(rates: Array<{
    date: string;
    baseCurrency: string;
    quoteCurrency: string;
    rate: number;
  }>): Promise<void> {
    if (!this.userId) throw new Error("seedFxRates requires userId");
    const response = await this.request.post(apiUrl("/__e2e/seed-fx-rates"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      data: {
        rates: rates.map((rate) => ({ ...rate, source: "frankfurter" })),
      },
    });
    if (!response.ok()) {
      throw new Error(`seedFxRates failed: ${response.status()} ${await response.text()}`);
    }
  }

  /**
   * Posts a dividend that produces a positive TWD cash entry on the seeded
   * `acc-1` account. Used to fund the source wallet without requiring a
   * prior position. Mirrors the seed pattern from `cash-ledger-aaa.spec.ts`.
   *
   * Note: `/__e2e/seed-dividend-event` auto-creates a BUY trade at $100/share
   * for `eligibleQuantity` shares as part of the dividend setup. We pin
   * `eligibleQuantity: 1` so the auto-BUY only costs ~100 TWD; the generous
   * `receivedCashAmount` then leaves the wallet net-positive by the desired
   * funding margin. (The cash-ledger spec doesn't care about net balance
   * because it only asserts table rows; we do — we drive an FX outflow.)
   */
  @Step()
  async fundTwdViaDividend(args: {
    paymentDate: string;
    amount: number;
  }): Promise<void> {
    if (!this.userId) throw new Error("fundTwdViaDividend requires userId");

    const seedResponse = await this.request.post(apiUrl("/__e2e/seed-dividend-event"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      data: {
        accountId: "acc-1",
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: args.paymentDate,
        paymentDate: args.paymentDate,
        cashDividendPerShare: args.amount,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        eligibleQuantity: 1,
      },
    });
    if (!seedResponse.ok()) {
      throw new Error(`fundTwdViaDividend seed failed: ${seedResponse.status()} ${await seedResponse.text()}`);
    }
    const seedBody = await seedResponse.json() as { dividendEvent?: { id?: string } };
    const dividendEventId = String(seedBody.dividendEvent?.id ?? "");
    if (!dividendEventId) {
      throw new Error("fundTwdViaDividend expected dividendEvent.id");
    }

    const postResponse = await this.request.post(
      new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href,
      {
        headers: {
          "content-type": "application/json",
          "x-user-id": this.userId,
          "idempotency-key": `kzo168-fund-${dividendEventId}`,
        },
        data: {
          accountId: "acc-1",
          dividendEventId,
          receivedCashAmount: args.amount,
          receivedStockQuantity: 0,
          deductions: [],
          sourceCompositionStatus: "unknown_pending_disclosure",
          sourceLines: [],
        },
      },
    );
    if (!postResponse.ok()) {
      throw new Error(`fundTwdViaDividend post failed: ${postResponse.status()} ${await postResponse.text()}`);
    }
  }
}
