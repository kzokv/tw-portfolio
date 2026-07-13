import { randomUUID } from "node:crypto";

import { PostgresPersistence } from "../../../apps/api/src/persistence/postgres.js";
import {
  createDividendEvent,
  postDividend,
  updateDividendReconciliationStatus,
} from "../../../apps/api/src/services/dividends.js";
import { createTransaction } from "../../../apps/api/src/services/portfolio.js";

const databaseUrl = process.env.DB_URL;
if (!databaseUrl) throw new Error("DB_URL is required");

const persistence = new PostgresPersistence({
  databaseUrl,
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6399",
});

const userId = "user-1";
const tickers = ["2330", "0050", "00919", "0056"] as const;
const statuses = ["open", "matched", "explained", "resolved"] as const;

async function main(): Promise<void> {
try {
  await persistence.init();
  await persistence.ensureDevBypassUser();
  const store = await persistence.loadStore(userId);
  const account = store.accounts[0];
  if (!account) throw new Error("Expected the default performance account");

  for (const [index, ticker] of tickers.entries()) {
    createTransaction(store, userId, {
      id: randomUUID(),
      accountId: account.id,
      ticker,
      marketCode: "TW",
      quantity: 25_000 + index * 5_000,
      unitPrice: 100 + index * 10,
      priceCurrency: "TWD",
      tradeDate: "2019-01-02",
      tradeTimestamp: `2019-01-02T0${index}:00:00.000Z`,
      type: "BUY",
      isDayTrade: false,
    });
  }

  const eventCount = Number(process.env.PERF_EVENT_COUNT ?? 280);
  for (let index = 0; index < eventCount; index += 1) {
    const year = 2020 + (index % 7);
    const month = 1 + (index % 12);
    const day = 1 + (index % 25);
    const ticker = tickers[index % tickers.length]!;
    const paymentDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const event = createDividendEvent(store, {
      id: randomUUID(),
      ticker,
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: paymentDate,
      paymentDate,
      cashDividendPerShare: 0.05 + (index % 19) * 0.01,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "performance_fixture",
      sourceReference: `performance-event-${index}`,
    });

    // Keep a meaningful expected-row population while exercising persisted
    // deductions, source-composition, reconciliation, and drawer hydration.
    if (index % 5 !== 0) {
      const receivedCashAmount = 1_000 + index * 13.37;
      const deductionAmount = 1 + (index % 17);
      const withheldAtSource = index % 2 === 0;
      const posted = postDividend(store, userId, {
        id: randomUUID(),
        accountId: account.id,
        dividendEventId: event.id,
        receivedCashAmount,
        receivedStockQuantity: 0,
        deductions: [
          {
            id: randomUUID(),
            deductionType: index % 3 === 0 ? "NHI_SUPPLEMENTAL_PREMIUM" : index % 3 === 1 ? "BANK_FEE" : "OTHER",
            amount: deductionAmount,
            currencyCode: "TWD",
            withheldAtSource,
            source: "performance_fixture",
          },
        ],
        sourceCompositionStatus: index % 4 === 0 ? "unknown_pending_disclosure" : "provided",
        sourceLines: index % 4 === 0 ? [] : [
          {
            id: randomUUID(),
            sourceBucket: "DIVIDEND_INCOME",
            amount: receivedCashAmount + (withheldAtSource ? deductionAmount : 0),
            currencyCode: "TWD",
            source: "performance_fixture",
          },
        ],
      });
      const status = statuses[index % statuses.length]!;
      if (status !== "open") {
        updateDividendReconciliationStatus(
          store,
          userId,
          posted.dividendLedgerEntry.id,
          status,
          status === "explained" ? "performance fixture" : undefined,
        );
      }
    }
  }

  await persistence.saveStore(store);
  process.stdout.write(JSON.stringify({
    userId,
    accountId: account.id,
    eventCount,
    expectedRows: Math.ceil(eventCount / 5),
    postedRows: eventCount - Math.ceil(eventCount / 5),
  }, null, 2) + "\n");
} finally {
  await persistence.close();
}
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
