import type { Page, Route } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

type AvailabilityOutcome =
  | { kind: "ready"; quantity: number }
  | { kind: "unavailable" }
  | { kind: "transport" };

async function fulfillAvailability(route: Route, outcome: AvailabilityOutcome): Promise<void> {
  if (outcome.kind === "transport") {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary QA failure" }) });
    return;
  }
  const url = new URL(route.request().url());
  const base = {
    accountId: url.searchParams.get("accountId") ?? "acc-1",
    ticker: url.searchParams.get("ticker") ?? "8401",
    marketCode: url.searchParams.get("marketCode") ?? "TW",
    tradeDate: url.searchParams.get("tradeDate") ?? "2026-07-20",
  };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(outcome.kind === "ready"
      ? { status: "ready", ...base, availableQuantity: outcome.quantity }
      : { status: "unavailable", ...base, reason: "unreplayable_history" }),
  });
}

async function installAvailabilityStub(page: Page, outcome: AvailabilityOutcome): Promise<void> {
  await page.route("**/portfolio/transactions/sell-availability?*", (route) => fulfillAvailability(route, outcome));
}

async function seedInstrument(settings: import("@vakwen/test-e2e/fixtures/appPages").TAppPagesFixtures["settings"], ticker: string): Promise<void> {
  await settings.arrange.seedInstruments([
    { ticker, name: `Sell Availability ${ticker}`, instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
  ]);
}

async function completeTransactionsSellForm(
  transactions: import("@vakwen/test-e2e/fixtures/appPages").TAppPagesFixtures["transactions"],
  ticker: string,
): Promise<void> {
  await transactions.actions.selectFirstAccount();
  await transactions.actions.selectTransactionType("SELL");
  await transactions.actions.typeInTickerSearch(ticker);
  await transactions.actions.selectTickerOption(ticker, "TW");
}

test("transactions SELL: loading → ready → Use max → oversell blocks submit", async ({
  page,
  settings,
  transactions,
}) => {
  await seedInstrument(settings, "8401");
  let releaseAvailability!: () => void;
  const availabilityGate = new Promise<void>((resolve) => { releaseAvailability = resolve; });
  await page.route("**/portfolio/transactions/sell-availability?*", async (route) => {
    await availabilityGate;
    await fulfillAvailability(route, { kind: "ready", quantity: 7 });
  });
  await transactions.actions.navigateToTransactions();

  const availability = transactions.actions.waitForSellAvailability();
  await completeTransactionsSellForm(transactions, "8401");
  await transactions.assert.sellAvailabilityIsLoading();
  releaseAvailability();
  await availability;
  await transactions.assert.sellAvailabilityReadyContains(/Available to sell: 7|可賣數量：7/);
  await transactions.actions.useMaximumSellQuantity();
  await transactions.assert.sellQuantityIs("7");
  await transactions.actions.fillQuantity(8);
  await transactions.assert.sellAvailabilityOversellIsVisible();
});

test("transactions SELL: zero availability → ready zero state blocks positive quantity", async ({ page, settings, transactions }) => {
  await seedInstrument(settings, "8402");
  await installAvailabilityStub(page, { kind: "ready", quantity: 0 });
  await transactions.actions.navigateToTransactions();
  await completeTransactionsSellForm(transactions, "8402");

  await transactions.assert.sellAvailabilityReadyContains(/Available to sell: 0|可賣數量：0/);
  await transactions.assert.sellAvailabilityOversellIsVisible();
});

test("transactions SELL: transport failure → warning remains fail-open for submission", async ({ page, settings, transactions }) => {
  await seedInstrument(settings, "8403");
  await installAvailabilityStub(page, { kind: "transport" });
  await transactions.actions.navigateToTransactions();
  await completeTransactionsSellForm(transactions, "8403");

  await transactions.assert.sellAvailabilityTransportWarningIsVisible();
  await transactions.assert.submitButtonIsEnabled();
});

test("transactions SELL: authoritative unavailable history → warning blocks submit", async ({ page, settings, transactions }) => {
  await seedInstrument(settings, "8404");
  await installAvailabilityStub(page, { kind: "unavailable" });
  await transactions.actions.navigateToTransactions();
  await completeTransactionsSellForm(transactions, "8404");

  await transactions.assert.sellAvailabilityUnavailableIsVisible();
});

test("global Add Transaction SELL: shared form renders authoritative ready state", async ({
  dashboard,
  page,
  settings,
  transactions,
}) => {
  await seedInstrument(settings, "8405");
  await installAvailabilityStub(page, { kind: "ready", quantity: 12 });
  await dashboard.actions.navigateToDashboard();
  await dashboard.actions.openFloatingQuickActions();
  await dashboard.actions.clickFloatingAddTransaction();
  await page.getByTestId("add-transaction-dialog").waitFor({ state: "visible" });
  await completeTransactionsSellForm(transactions, "8405");

  await transactions.assert.sellAvailabilityReadyContains(/Available to sell: 12|可賣數量：12/);
  await transactions.actions.useMaximumSellQuantity();
  await transactions.assert.sellQuantityIs("12");
});

test("ticker Record Transaction SELL: shared form renders authoritative ready state", async ({
  dashboard,
  page,
  settings,
  ticker,
  transactions,
}) => {
  await seedInstrument(settings, "8406");
  await dashboard.arrange.seedTrade({ ticker: "8406", quantity: 20, unitPrice: 100, tradeDate: "2026-07-01" });
  await installAvailabilityStub(page, { kind: "ready", quantity: 20 });
  await ticker.actions.navigateToTicker("8406?marketCode=TW");
  await ticker.actions.openRecordDialog();
  await transactions.actions.selectTransactionType("SELL");

  await transactions.assert.sellAvailabilityReadyContains(/Available to sell: 20|可賣數量：20/);
  await transactions.actions.useMaximumSellQuantity();
  await transactions.assert.sellQuantityIs("20");
});

test("transactions SELL: real as-of history becomes stale → server rejects oversell", async ({
  dashboard,
  request,
  settings,
  testUser,
  transactions,
}) => {
  const ticker = "8410";
  await seedInstrument(settings, ticker);
  await dashboard.arrange.seedTrade({ ticker, quantity: 6, unitPrice: 100, tradeDate: "2026-07-01" });
  await dashboard.arrange.seedTrade({ ticker, quantity: 4, unitPrice: 101, tradeDate: "2026-07-02" });
  const actionResponse = await request.post(new URL("/corporate-actions", TestEnv.apiBaseUrl).href, {
    headers: { "x-user-id": testUser.userId },
    data: {
      accountId: "acc-1",
      ticker,
      actionType: "SPLIT",
      numerator: 2,
      denominator: 1,
      actionDate: "2026-07-05",
    },
  });
  await transactions.assert.apiResponseIsOk(actionResponse);
  const asOfResponse = await request.get(new URL(
    `/portfolio/transactions/sell-availability?accountId=acc-1&ticker=${ticker}&marketCode=TW&tradeDate=2026-07-10`,
    TestEnv.apiBaseUrl,
  ).href, { headers: { "x-user-id": testUser.userId } });
  await transactions.assert.apiSellAvailabilityIs(asOfResponse, 20);

  await transactions.actions.navigateToTransactions();
  await transactions.actions.selectFirstAccount();
  await transactions.actions.selectTransactionType("SELL");
  await transactions.actions.fillTradeDate("2026-07-10");
  const availabilityResponse = transactions.actions.waitForSellAvailability();
  await transactions.actions.typeInTickerSearch(ticker);
  await transactions.actions.selectTickerOption(ticker, "TW");
  await availabilityResponse;
  await transactions.assert.sellAvailabilityReadyContains(/Available to sell: 20|可賣數量：20/);
  await transactions.actions.useMaximumSellQuantity();
  await transactions.actions.fillUnitPrice(110);

  await dashboard.arrange.seedTrade({ ticker, quantity: 15, unitPrice: 109, tradeDate: "2026-07-08", type: "SELL" });

  const staleResponse = await transactions.actions.submitTransactionAndWaitForResponse();
  await transactions.assert.transactionResponseIsOversell(staleResponse, 20, 5);
});
