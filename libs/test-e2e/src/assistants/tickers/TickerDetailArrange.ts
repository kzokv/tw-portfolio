import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";

import type { TickerDetailPage } from "../../pages/tickers/TickerDetailPage.js";

interface TSeedTradeOptions {
  accountId?: string;
  ticker?: string;
  marketCode?: "TW" | "US" | "AU";
  quantity?: number;
  unitPrice?: number;
  priceCurrency?: string;
  tradeDate?: string;
  type?: "BUY" | "SELL";
  isDayTrade?: boolean;
}

interface TSeedInstrumentOptions {
  ticker: string;
  name: string | null;
  instrumentType: string | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt?: string;
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
          marketCode: "TW",
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

  @Step()
  async seedInstruments(instruments: TSeedInstrumentOptions[]): Promise<void> {
    if (!this.userId) throw new Error("seedInstruments requires userId");

    const response = await this.request.post(apiUrl("/__e2e/seed-instruments"), {
      headers: { "x-user-id": this.userId },
      data: { instruments },
    });
    if (!response.ok()) throw new Error(`seedInstruments failed: ${response.status()} ${await response.text()}`);
  }

  @Step()
  async setManualMonitoredTickers(
    tickers: Array<string | { ticker: string; marketCode?: string }>,
  ): Promise<void> {
    if (!this.userId) throw new Error("setManualMonitoredTickers requires userId");

    const response = await this.request.put(apiUrl("/monitored-tickers"), {
      headers: { "x-user-id": this.userId },
      data: {
        tickers: tickers.map((item) =>
          typeof item === "string"
            ? { ticker: item, marketCode: "TW" }
            : { ticker: item.ticker, marketCode: item.marketCode ?? "TW" },
        ),
      },
    });
    if (!response.ok()) throw new Error(`setManualMonitoredTickers failed: ${response.status()} ${await response.text()}`);
  }

  @Step()
  async publishRepairEvent(eventType: "repair_started" | "repair_complete" | "repair_failed", data: Record<string, unknown>): Promise<void> {
    if (!this.userId) throw new Error("publishRepairEvent requires userId");

    const response = await this.request.post(apiUrl("/__test/publish-event"), {
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      data: { type: eventType, data },
    });
    if (!response.ok()) throw new Error(`publishRepairEvent failed: ${response.status()} ${await response.text()}`);
  }
}
