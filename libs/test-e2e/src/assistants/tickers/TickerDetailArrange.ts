import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { TickerDetailPage } from "../../pages/tickers/TickerDetailPage.js";

interface TSeedTradeOptions {
  accountId?: string;
  ticker?: string;
  quantity?: number;
  unitPrice?: number;
  priceCurrency?: string;
  tradeDate?: string;
  type?: "BUY" | "SELL";
  isDayTrade?: boolean;
}

export class TickerDetailArrange extends BaseArrange {
  declare protected readonly _instance: TickerDetailPage;

  @Step()
  async seedTrade(overrides: TSeedTradeOptions = {}): Promise<void> {
    if (!this.userId) throw new Error("seedTrade requires userId");

    const res = await this.request.post(
      new URL("/portfolio/transactions", TestEnv.apiBaseUrl).href,
      {
        headers: {
          "content-type": "application/json",
          "x-user-id": this.userId,
          "idempotency-key": `seed-${Date.now()}-${Math.random()}`,
        },
        data: {
          accountId: "acc-1",
          ticker: "2330",
          quantity: 100,
          unitPrice: 500,
          priceCurrency: "TWD",
          tradeDate: "2026-01-15",
          type: "BUY",
          isDayTrade: false,
          ...overrides,
        },
      },
    );
    if (!res.ok()) throw new Error(`seedTrade failed: ${res.status()} ${await res.text()}`);
  }
}
