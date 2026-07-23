vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "dev_bypass",
      getDatabaseUrl: () =>
        process.env.POSTGRES_TEST_DB_URL
        ?? process.env.DB_URL
        ?? original.Env.getDatabaseUrl(),
      getRedisUrl: () =>
        process.env.POSTGRES_TEST_REDIS_URL
        ?? process.env.REDIS_URL
        ?? original.Env.getRedisUrl(),
    },
  };
});

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { createDividendEvent, postDividend } from "../../src/services/dividends.js";
import { transactionPayload } from "../helpers/fixtures.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or "
      + "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const describePostgres = runPostgresIntegration && databaseUrl && redisUrl ? describe : describe.skip;

async function resetDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    client.release();
    await pool.end();
  }
}

async function applyBaselineMigration(): Promise<void> {
  const manifest = await migrationManifestPromise;
  if (!manifest.baselineMigration) {
    throw new Error("expected a baseline migration for managed Postgres tests");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(await fs.readFile(path.join(migrationsDir, manifest.baselineMigration), "utf8"));
  } finally {
    client.release();
    await pool.end();
  }
}

describePostgres("transaction write concurrency (Postgres)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await resetDatabase();
    await applyBaselineMigration();
    app = await buildApp({ persistenceBackend: "postgres", registerWorkers: false });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("preserves same-user writes across different tickers, accounts, and a dividend posting", async () => {
    const initialStore = await app.persistence.loadStore("user-1");
    const primaryAccountId = initialStore.accounts[0]!.id;
    const differentTickerResponses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-ticker-2330" },
        payload: transactionPayload({ accountId: primaryAccountId, ticker: "2330", quantity: 2 }),
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-ticker-0050" },
        payload: transactionPayload({ accountId: primaryAccountId, ticker: "0050", quantity: 3 }),
      }),
    ]);
    expect(differentTickerResponses.map((response) => response.statusCode)).toEqual([200, 200]);

    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "Second Brokerage",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const secondAccountId = accountResponse.json().id as string;

    const differentAccountResponses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-account-primary" },
        payload: transactionPayload({ accountId: primaryAccountId, ticker: "2330", quantity: 4 }),
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-account-secondary" },
        payload: transactionPayload({ accountId: secondAccountId, ticker: "2330", quantity: 5 }),
      }),
    ]);
    expect(differentAccountResponses.map((response) => response.statusCode)).toEqual([200, 200]);

    const expectedIds = [...differentTickerResponses, ...differentAccountResponses]
      .map((response) => response.json().id as string);
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents.filter((trade) => expectedIds.includes(trade.id))).toHaveLength(4);

    const dividendEvent = createDividendEvent(store, {
      id: "pg-concurrent-dividend-event",
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    });
    const dividendPosting = postDividend(store, "user-1", {
      id: "pg-concurrent-dividend-ledger",
      accountId: primaryAccountId,
      dividendEventId: dividendEvent.id,
      receivedCashAmount: 6,
      receivedStockQuantity: 0,
      deductions: [],
      sourceLines: [],
      sourceCompositionStatus: "provided",
    });

    const [transactionResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-with-dividend" },
        payload: transactionPayload({ accountId: primaryAccountId, ticker: "00919", quantity: 6 }),
      }),
      app.persistence.savePostedDividend(
        "user-1",
        store.accounting,
        store.marketData,
        dividendPosting.dividendLedgerEntry.id,
      ),
    ]);
    expect(transactionResponse.statusCode).toBe(200);

    const finalStore = await app.persistence.loadStore("user-1");
    expect(finalStore.accounting.facts.tradeEvents).toContainEqual(
      expect.objectContaining({ id: transactionResponse.json().id, ticker: "00919" }),
    );
    expect(finalStore.accounting.facts.dividendLedgerEntries).toContainEqual(
      expect.objectContaining({ id: dividendPosting.dividendLedgerEntry.id }),
    );

    const concurrentSells = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-sell-first" },
        payload: transactionPayload({
          accountId: primaryAccountId,
          ticker: "00919",
          quantity: 4,
          unitPrice: 110,
          tradeDate: "2026-03-01",
          type: "SELL",
        }),
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "pg-concurrent-sell-second" },
        payload: transactionPayload({
          accountId: primaryAccountId,
          ticker: "00919",
          quantity: 4,
          unitPrice: 111,
          tradeDate: "2026-03-01",
          type: "SELL",
        }),
      }),
    ]);
    expect(concurrentSells.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(concurrentSells.find((response) => response.statusCode === 409)?.json()).toMatchObject({
      error: "insufficient_quantity",
      metadata: {
        requestedQuantity: 4,
        availableQuantity: 2,
      },
    });
  });
});
