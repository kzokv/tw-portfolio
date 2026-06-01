import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";

let app: AppInstance;

describe("GET /accounts?includeBalances=true", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns rounded live balances and excludes reversed cash-ledger entries", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.cashLedgerEntries.push(
      {
        id: "cash-1",
        userId: "user-1",
        accountId: "acc-1",
        entryDate: "2025-01-10",
        entryType: "MANUAL_ADJUSTMENT",
        amount: 100.125,
        currency: "USD",
        source: "test",
      },
      {
        id: "cash-2",
        userId: "user-1",
        accountId: "acc-1",
        entryDate: "2025-01-11",
        entryType: "MANUAL_ADJUSTMENT",
        amount: -40.005,
        currency: "USD",
        source: "test",
      },
      {
        id: "cash-3",
        userId: "user-1",
        accountId: "acc-1",
        entryDate: "2025-01-12",
        entryType: "REVERSAL",
        amount: -100.125,
        currency: "USD",
        source: "test",
        reversalOfCashLedgerEntryId: "cash-1",
      },
      {
        id: "cash-4",
        userId: "user-1",
        accountId: "acc-1",
        entryDate: "2025-01-13",
        entryType: "MANUAL_ADJUSTMENT",
        amount: 2500.333,
        currency: "TWD",
        source: "test",
      },
    );

    const response = await app.inject({
      method: "GET",
      url: "/accounts?includeBalances=true",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("total;dur=");
    const body = response.json() as Array<{
      id: string;
      liveBalance?: Array<{ currency: string; amount: number }>;
    }>;
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "acc-1",
        liveBalance: [
          { currency: "TWD", amount: 2500.33 },
          { currency: "USD", amount: -40.01 },
        ],
      }),
    ]));
  });
});
