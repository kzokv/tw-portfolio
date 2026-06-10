import { appPagesTest as test } from "@vakwen/test-e2e/fixtures";

import { seedQuoteBars } from "./helpers/anonymousShare.js";
import { seedAccountForUser, seedTransactionForUser } from "./helpers/sharing.js";

test.describe("portfolio holdings grouping", () => {
  test("[portfolio holdings]: grouped row expands, persists allocation basis, and routes aggregate/account links → ticker views", async ({
    e2eUserId,
    page,
    portfolio,
  }) => {
    const ticker = "6772";
    const marketCode = "TW";
    const secondaryAccount = await seedAccountForUser(e2eUserId, {
      name: "Grouped Holdings Secondary Broker",
    });

    await seedTransactionForUser(e2eUserId, {
      ticker,
      quantity: 100,
      unitPrice: 500,
      tradeDate: "2026-01-02",
    });
    await seedTransactionForUser(e2eUserId, {
      accountId: secondaryAccount.id,
      ticker,
      quantity: 25,
      unitPrice: 520,
      tradeDate: "2026-01-03",
    });
    await seedQuoteBars([
      {
        ticker,
        barDate: "2026-04-18",
        open: 610,
        high: 610,
        low: 610,
        close: 610,
        volume: 1000,
      },
    ]);

    await portfolio.actions.navigateToPortfolio();
    await portfolio.assert.holdingsTableIsVisible();
    await portfolio.assert.holdingsFilterControlsAreVisible();
    await portfolio.assert.holdingGroupRowIsVisible(ticker, marketCode);

    await portfolio.actions.setDisplayModeGrouped();
    await portfolio.assert.holdingChildRowIsHidden(ticker, marketCode, "acc-1");

    await portfolio.actions.setDisplayModeExpanded();
    await portfolio.assert.holdingChildRowIsVisible(ticker, marketCode, "acc-1");
    await portfolio.assert.holdingChildRowIsVisible(ticker, marketCode, secondaryAccount.id);

    await portfolio.actions.setDisplayModeGrouped();
    await portfolio.assert.holdingChildRowIsHidden(ticker, marketCode, "acc-1");
    await portfolio.actions.expandHoldingGroup(ticker, marketCode);
    await portfolio.assert.holdingChildRowIsVisible(ticker, marketCode, secondaryAccount.id);

    await portfolio.actions.setAllocationBasisCostBasis();
    await portfolio.assert.allocationBasisCostBasisIsSelected();
    await page.reload({ waitUntil: "domcontentloaded" });
    await portfolio.assert.holdingsTableIsVisible();
    await portfolio.assert.allocationBasisCostBasisIsSelected();

    await portfolio.actions.openHoldingGroup(ticker, marketCode);

    await portfolio.actions.navigateToPortfolio();
    await portfolio.actions.setDisplayModeGrouped();
    await portfolio.actions.expandHoldingGroup(ticker, marketCode);
    await portfolio.actions.openHoldingChild(ticker, marketCode, secondaryAccount.id);
  });
});
