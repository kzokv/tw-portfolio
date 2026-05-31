/**
 * HTTP AAA tests for KZO-169: market_code selector + composite (ticker, market_code)
 * disambiguation on the transaction form's API surface.
 *
 * Covers (per scope-todo Phase 8 → AC mapping in `.worklog/team/qa-test-plan.md` §1):
 *   S9-T1  GET /instruments?market_code=TW filters to TW-only rows
 *   S9-T2  GET /instruments?market_code=ALL returns rows from every market
 *   S9-T3  POST /portfolio/transactions with valid (ticker, marketCode) + matching
 *          account currency → 200 success
 *   S9-T4  POST /portfolio/transactions with mismatched account currency → 400
 *          `currency_mismatch` (asserts on `body.error`, NOT `body.code`, per
 *          `service-error-pattern.md`)
 *   S9-T5  POST /portfolio/transactions/estimate accepts the new `marketCode` body
 *          field and returns finite commission/tax (route derives trade currency
 *          internally; response shape unchanged per Architect A2)
 *   S9-T6  POST /portfolio/transactions missing `marketCode` body → 400
 *   S9-T7  GET /instruments?market_code=US with no seeded US rows → empty
 *
 * Precedent: `account-currency-and-type-aaa.http.spec.ts` (KZO-167) — same shape
 * for accountsApi + transactionsApi flows + `routeError` envelope assertions.
 *
 * Infra prerequisite (P-1, qa-test-plan §0): `/__e2e/seed-instruments` guard
 * loosened from `assertE2EResetEnabled()` to `assertE2ESeedEnabled()` in
 * `registerRoutes.ts:1449` (Fix-P1) so the HTTP suite (oauth) can call the seed
 * route. Without that swap these tests would 404 on every seed.
 */

import { randomUUID } from "node:crypto";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("transaction form market_code (KZO-169)", () => {
  // ── S9-T1 ─────────────────────────────────────────────────────────────────
  // Server-side market filter narrows the catalog to a single market.

  test("[GET /instruments]: market_code=TW → only TW instruments returned", async ({
    instrumentsApi,
  }) => {
    // Arrange — seed BHP on AU + a US instrument alongside the default TW catalog
    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "2330",
        name: "TSMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
      {
        ticker: "BHP",
        name: "BHP Group AU",
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      },
      {
        ticker: "BHP",
        name: "BHP Group US",
        instrumentType: "STOCK",
        marketCode: "US",
        barsBackfillStatus: "ready",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    // Act
    const listResp = await instrumentsApi.actions.listInstruments("TW");
    await instrumentsApi.assert.statusIs(listResp, 200);

    // Assert — every returned row has marketCode === "TW"
    const items = await instrumentsApi.arrange.instruments(listResp);
    await instrumentsApi.assert.everyMarketCodeIs(items, "TW");
    // Sanity: at least one TW row (2330) appears.
    await instrumentsApi.assert.pairExists(items, "2330", "TW");
    // Negative: BHP·AU and BHP·US must be absent from the TW filter.
    await instrumentsApi.assert.pairAbsent(items, "BHP", "AU");
    await instrumentsApi.assert.pairAbsent(items, "BHP", "US");
  });

  // ── S9-T2 ─────────────────────────────────────────────────────────────────
  // ALL mode returns every seeded row regardless of market.

  test("[GET /instruments]: market_code=ALL → both BHP·AU and BHP·US returned", async ({
    instrumentsApi,
  }) => {
    // Arrange — seed BOTH BHP rows + a TW row to confirm ALL crosses markets
    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "2330",
        name: "TSMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
      {
        ticker: "BHP",
        name: "BHP Group AU",
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      },
      {
        ticker: "BHP",
        name: "BHP Group US",
        instrumentType: "STOCK",
        marketCode: "US",
        barsBackfillStatus: "ready",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    // Act
    const listResp = await instrumentsApi.actions.listInstruments("ALL");
    await instrumentsApi.assert.statusIs(listResp, 200);

    // Assert — both BHP rows + TW row are visible. The composite (ticker, market)
    // pair is the disambiguation key — same ticker on different markets coexist.
    const items = await instrumentsApi.arrange.instruments(listResp);
    await instrumentsApi.assert.pairExists(items, "BHP", "AU");
    await instrumentsApi.assert.pairExists(items, "BHP", "US");
    await instrumentsApi.assert.pairExists(items, "2330", "TW");
  });

  // ── S9-T3 ─────────────────────────────────────────────────────────────────
  // Happy-path POST: account currency matches currencyFor(marketCode).

  test("[POST /portfolio/transactions]: BHP·US trade against USD account → 200 success", async ({
    accountsApi,
    instrumentsApi,
    transactionsApi,
  }) => {
    // Arrange — create a fresh USD account. KZO-179 auto-seeds a fee profile
    // owned by the new account whose `commissionCurrency` matches the
    // account's `defaultCurrency`. The trade route's secondary guard
    // `tradeCurrency !== feeProfile.commissionCurrency` is therefore satisfied.
    //
    // Why not PATCH acc-1 to USD? acc-1 keeps its TWD-currency fee profile,
    // so the fee-profile commissionCurrency check fires before the trade lands.
    const newAccountResp = await accountsApi.actions.createAccount({
      name: "USD Brokerage (S9-T3)",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(newAccountResp, 200);
    const usdAccount = (await newAccountResp.json()) as { id: string };

    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "BHP",
        name: "BHP Group US",
        instrumentType: "STOCK",
        marketCode: "US",
        barsBackfillStatus: "ready",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    // Act — POST with the new (ticker, marketCode) body shape
    const txResp = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: usdAccount.id,
        ticker: "BHP",
        marketCode: "US",
        priceCurrency: "USD",
        quantity: 5,
        unitPrice: 50,
        type: "BUY",
        isDayTrade: false,
      }),
      randomUUID(),
    );

    // Assert — 200 + the persisted trade event reflects the marketCode body.
    await transactionsApi.assert.statusIs(txResp, 200);
    const tx = (await txResp.json()) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(tx, "marketCode", "US");
    await accountsApi.assert.fieldEquals(tx, "ticker", "BHP");
  });

  // ── S9-T4 ─────────────────────────────────────────────────────────────────
  // Mismatched account currency hits the route's currency_mismatch guard.
  //
  // The envelope shape per `service-error-pattern.md` "JSON envelope shape" is
  //   { error: "currency_mismatch", message: "..." }
  // ASSERT on body.error — NOT body.code. (KZO-167 iter 1 burned a Phase-3 cycle
  // on this exact mistake.)

  test("[POST /portfolio/transactions]: BHP·US trade against TWD account → 400 currency_mismatch", async ({
    accountsApi,
    instrumentsApi,
    transactionsApi,
  }) => {
    // Arrange — acc-1 stays at the default TWD; seed BHP on US.
    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "BHP",
        name: "BHP Group US",
        instrumentType: "STOCK",
        marketCode: "US",
        barsBackfillStatus: "ready",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    // Act — TWD account + US trade is exactly the path the form chip filter
    // exists to prevent on the client; the server still rejects.
    const txResp = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "US",
        priceCurrency: "USD",
        quantity: 5,
        unitPrice: 50,
        type: "BUY",
        isDayTrade: false,
      }),
      randomUUID(),
    );

    // Assert — 400 + the JSON envelope's `error` field carries the code.
    await transactionsApi.assert.statusIs(txResp, 400);
    const errorBody = (await txResp.json()) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(errorBody, "error", "currency_mismatch");
  });

  // ── S9-T5 ─────────────────────────────────────────────────────────────────
  // /estimate accepts marketCode and derives trade currency internally.
  // Per Architect A2: response shape unchanged ({ commissionAmount, taxAmount });
  // assertion is non-rejection + finite numbers.

  test("[POST /portfolio/transactions/estimate]: accepts marketCode body field → 200 + finite estimates", async ({
    accountsApi,
    instrumentsApi,
    transactionsApi,
  }) => {
    // Arrange — create a fresh USD account (auto-seeded USD fee profile so the
    // commission-currency invariant inside the estimate route is satisfied)
    // and seed BHP·US.
    const newAccountResp = await accountsApi.actions.createAccount({
      name: "USD Brokerage (S9-T5)",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(newAccountResp, 200);
    const usdAccount = (await newAccountResp.json()) as { id: string };

    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "BHP",
        name: "BHP Group US",
        instrumentType: "STOCK",
        marketCode: "US",
        barsBackfillStatus: "ready",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    // Act
    const estimateResp = await transactionsApi.actions.estimateTransaction({
      ticker: "BHP",
      marketCode: "US",
      quantity: 5,
      unitPrice: 50,
      type: "BUY",
      isDayTrade: false,
      accountId: usdAccount.id,
    });

    // Assert — the route accepts the new body field (regression signal: 4xx
    // would mean Slice 3 broke marketCode acceptance) and returns finite numbers.
    await transactionsApi.assert.statusIs(estimateResp, 200);
    const body = (await estimateResp.json()) as Record<string, unknown>;
    const commissionAmount = body["commissionAmount"];
    const taxAmount = body["taxAmount"];
    await accountsApi.assert.mxAssertEqual(
      typeof commissionAmount === "number" && Number.isFinite(commissionAmount),
      true,
      "commissionAmount is finite number",
    );
    await accountsApi.assert.mxAssertEqual(
      typeof taxAmount === "number" && Number.isFinite(taxAmount),
      true,
      "taxAmount is finite number",
    );
  });

  // ── S9-T6 ─────────────────────────────────────────────────────────────────
  // Zod rejects bodies missing `marketCode` (D3 made it required, no default).

  test("[POST /portfolio/transactions]: body missing marketCode → 400 Zod validation", async ({
    transactionsApi,
  }) => {
    // Build a payload, then strip `marketCode` to simulate a stale client
    // that hasn't been updated to the KZO-169 body shape.
    const fullPayload = transactionPayload({
      accountId: "acc-1",
      ticker: "2330",
      priceCurrency: "TWD",
      type: "BUY",
      quantity: 1,
      unitPrice: 100,
    }) as Record<string, unknown>;
    // transactionPayload() default doesn't include marketCode; explicitly remove
    // the field if a future fixture default ever adds it.
    delete fullPayload["marketCode"];

    // Act
    const txResp = await transactionsApi.actions.createTransaction(fullPayload, randomUUID());

    // Assert — Zod rejection
    await transactionsApi.assert.statusIs(txResp, 400);
  });

  // ── S9-T7 ─────────────────────────────────────────────────────────────────
  // Server-side filtering when no rows match is a confirmation that the filter
  // runs server-side, not client-side.

  test("[GET /instruments]: market_code=US with no US instruments → empty", async ({
    instrumentsApi,
  }) => {
    // Arrange — seed only TW rows; no US instruments.
    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "2330",
        name: "TSMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    // Act
    const listResp = await instrumentsApi.actions.listInstruments("US");
    await instrumentsApi.assert.statusIs(listResp, 200);

    // Assert — empty array.
    const items = await instrumentsApi.arrange.instruments(listResp);
    await instrumentsApi.assert.instrumentsCount(items, 0);
  });
});
