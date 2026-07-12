import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccountDto } from "@vakwen/shared-types";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import type { BookedTradeEvent, DividendEvent, DividendLedgerEntry } from "../../src/types/store.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or " +
      "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

async function resetDatabase(): Promise<void> {
  const resetPool = new Pool({ connectionString: databaseUrl });
  const client = await resetPool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    client.release();
    await resetPool.end();
  }
}

describePostgres("PostgresPersistence.listDividendReviewRows", () => {
  let persistence: PostgresPersistence;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("orders mixed persisted and generated rows deterministically when expected-net values tie", async () => {
    const store = await persistence.loadStore("user-1");
    const accountA = store.accounts[0]!;
    accountA.name = "Account A";
    const accountB: AccountDto = {
      ...accountA,
      id: "acc-2",
      name: "Account B",
      feeProfileId: "acc-2-fp-default",
      defaultCurrency: "TWD",
    };
    store.accounts.push(accountB);

    const feeProfile = store.feeProfiles[0]!;
    const accountBFeeProfile = {
      ...feeProfile,
      id: accountB.feeProfileId,
      accountId: accountB.id,
      taxRules: feeProfile.taxRules?.map((rule) => ({
        ...rule,
        id: rule.id.replace(feeProfile.id, accountB.feeProfileId),
      })),
    };
    store.feeProfiles.push(accountBFeeProfile);
    let bookingSequence = 0;
    const addTrade = (input: {
      accountId: string;
      ticker: string;
      tradeDate: string;
    }): BookedTradeEvent => ({
      id: randomUUID(),
      userId: store.userId,
      accountId: input.accountId,
      ticker: input.ticker,
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 100,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: input.tradeDate,
      bookingSequence: ++bookingSequence,
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: input.accountId === accountB.id ? accountBFeeProfile : feeProfile,
    });
    const addEvent = (input: {
      id: string;
      ticker: string;
      exDividendDate: string;
      paymentDate: string;
    }): DividendEvent => ({
      id: input.id,
      ticker: input.ticker,
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: input.exDividendDate,
      paymentDate: input.paymentDate,
      cashDividendPerShare: 2,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test_seed",
      createdAt: new Date().toISOString(),
    });
    const addLedger = (input: {
      id: string;
      accountId: string;
      dividendEventId: string;
    }): DividendLedgerEntry => ({
      id: input.id,
      accountId: input.accountId,
      dividendEventId: input.dividendEventId,
      eligibleQuantity: 100,
      expectedCashAmount: 200,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
    });

    const sharedEventAId = "event-aaa-a";
    const sharedEventBId = "event-aaa-b";
    const earlierEventId = "event-zzz-earlier";
    const laterTickerEventId = "event-zzz-later";
    store.accounting.facts.tradeEvents.push(
      addTrade({ accountId: accountA.id, ticker: "AAA", tradeDate: "2024-05-01" }),
      addTrade({ accountId: accountB.id, ticker: "AAA", tradeDate: "2024-05-01" }),
      addTrade({ accountId: accountA.id, ticker: "ZZZ", tradeDate: "2024-05-01" }),
    );
    store.marketData.dividendEvents.push(
      addEvent({
        id: sharedEventAId,
        ticker: "AAA",
        exDividendDate: "2024-06-01",
        paymentDate: "2024-07-10",
      }),
      addEvent({
        id: sharedEventBId,
        ticker: "AAA",
        exDividendDate: "2024-06-01",
        paymentDate: "2024-07-10",
      }),
      addEvent({
        id: earlierEventId,
        ticker: "ZZZ",
        exDividendDate: "2024-05-25",
        paymentDate: "2024-07-09",
      }),
      addEvent({
        id: laterTickerEventId,
        ticker: "ZZZ",
        exDividendDate: "2024-06-01",
        paymentDate: "2024-07-10",
      }),
    );
    store.accounting.facts.dividendLedgerEntries.push(
      addLedger({ id: "ledger-aaa-a", accountId: accountB.id, dividendEventId: sharedEventAId }),
      addLedger({ id: "ledger-aaa-b", accountId: accountB.id, dividendEventId: sharedEventBId }),
      addLedger({ id: "ledger-zzz-earlier", accountId: accountA.id, dividendEventId: earlierEventId }),
      addLedger({ id: "ledger-zzz-later", accountId: accountA.id, dividendEventId: laterTickerEventId }),
    );
    await persistence.saveStore(store);

    const review = await persistence.listDividendReviewRows(store.userId, {
      page: 1,
      limit: 10,
      sortBy: "expectedNetAmount",
      sortOrder: "asc",
    });

    expect(review.rows.map((row) => ({
      id: row.id,
      rowKind: row.rowKind,
      accountId: row.accountId,
      ticker: row.ticker,
      paymentDate: row.paymentDate,
      expectedNetAmount: row.expectedNetAmount,
    }))).toEqual([
      {
        id: "ledger-zzz-earlier",
        rowKind: "ledger",
        accountId: accountA.id,
        ticker: "ZZZ",
        paymentDate: "2024-07-09",
        expectedNetAmount: 200,
      },
      {
        id: `expected:${accountA.id}:${sharedEventAId}`,
        rowKind: "expected",
        accountId: accountA.id,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: `expected:${accountA.id}:${sharedEventBId}`,
        rowKind: "expected",
        accountId: accountA.id,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: "ledger-aaa-a",
        rowKind: "ledger",
        accountId: accountB.id,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: "ledger-aaa-b",
        rowKind: "ledger",
        accountId: accountB.id,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: "ledger-zzz-later",
        rowKind: "ledger",
        accountId: accountA.id,
        ticker: "ZZZ",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
    ]);
  });
});
