import { randomUUID } from "node:crypto";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedAccountForUser,
  seedTransactionForUser,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

test.describe("holdings selection persistence", () => {
  test("[holdings selection]: portfolio custom selection persists across reload and dashboard summary stays in sync", async ({
    appShell,
    dashboard,
    page,
    settings,
  }) => {
    const seedId = randomUUID();
    const member = await seedUser({
      sub: `e2e-holdings-selection-persistence-${seedId}`,
      email: `holdings-selection-persistence-${seedId}@example.com`,
      name: "Holdings Selection Persistence",
      role: "member",
    });
    const account = await seedAccountForUser(member.userId, {
      name: `Selection Brokerage ${seedId}`,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await settings.arrange.seedInstruments([
      { ticker: "8811", name: "Selection One", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
      { ticker: "8812", name: "Selection Two", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
    ]);
    await dashboard.arrange.seedDailyBars([
      { ticker: "8811", marketCode: "TW", barDate: "2026-07-16", open: 100, high: 102, low: 99, close: 101, volume: 10_000 },
      { ticker: "8812", marketCode: "TW", barDate: "2026-07-16", open: 200, high: 202, low: 198, close: 201, volume: 20_000 },
    ]);
    await seedTransactionForUser(member.userId, {
      accountId: account.id,
      ticker: "8811",
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-07-15",
      type: "BUY",
    });
    await seedTransactionForUser(member.userId, {
      accountId: account.id,
      ticker: "8812",
      quantity: 20,
      unitPrice: 200,
      tradeDate: "2026-07-15",
      type: "BUY",
    });
    await switchIdentity(page, { userId: member.userId, role: "member" });

    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.assert.appIsReady();
    const portfolioSection = page.getByTestId("portfolio-holdings-section");
    await portfolioSection.waitFor({ state: "visible" });

    const selectionSavePromise = page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && response.url().endsWith("/user-preferences"),
    );
    await portfolioSection.getByTestId("holding-group-row-8811-TW")
      .getByTestId("holdings-selection-toggle-TW:8811")
      .click();
    const selectionSaveResponse = await selectionSavePromise;
    if (!selectionSaveResponse.ok()) {
      throw new Error(`holdings selection save failed: ${selectionSaveResponse.status()} ${await selectionSaveResponse.text()}`);
    }
    await portfolioSection.getByTestId("holdings-selection-picker-trigger").waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(
      await portfolioSection.getByTestId("holdings-selection-picker-trigger").textContent(),
      "1 selected",
      "portfolio picker trigger text",
    );
    await appShell.assert.mxAssertIncludes(
      await portfolioSection.getByTestId("holdings-selection-summary-counts").textContent(),
      "1 visible of 1 selected",
      "portfolio selection summary counts",
    );
    await appShell.assert.mxAssertEqual(
      await portfolioSection.getByTestId("holding-group-row-8811-TW").isVisible(),
      true,
      "clicked ticker remains visible in custom mode",
    );
    await appShell.assert.mxAssertEqual(
      await portfolioSection.getByTestId("holding-group-row-8812-TW").isVisible().catch(() => false),
      false,
      "unclicked ticker is excluded from custom mode",
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await portfolioSection.waitFor({ state: "visible" });
    const persistedPortfolioPicker = portfolioSection.getByTestId("holdings-selection-picker-trigger");
    const persistedPortfolioSummary = portfolioSection.getByTestId("holdings-selection-summary-counts");
    await persistedPortfolioPicker.filter({ hasText: "1 selected" }).waitFor({ state: "visible" });
    await persistedPortfolioSummary.filter({ hasText: "1 visible of 1 selected" }).waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(
      await persistedPortfolioPicker.textContent(),
      "1 selected",
      "portfolio picker trigger persists after reload",
    );
    await appShell.assert.mxAssertIncludes(
      await persistedPortfolioSummary.textContent(),
      "1 visible of 1 selected",
      "portfolio selection summary persists after reload",
    );

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    const dashboardPreview = page.getByTestId("dashboard-holdings-preview");
    await dashboardPreview.waitFor({ state: "visible" });
    const dashboardPicker = dashboardPreview.getByTestId("holdings-selection-picker-trigger");
    const dashboardSummary = dashboardPreview.getByTestId("holdings-selection-summary-counts");
    await dashboardPicker.filter({ hasText: "1 selected" }).waitFor({ state: "visible" });
    await dashboardSummary.filter({ hasText: "1 visible of 1 selected" }).waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(
      await dashboardPicker.textContent(),
      "1 selected",
      "dashboard picker trigger mirrors portfolio selection",
    );
    await appShell.assert.mxAssertIncludes(
      await dashboardSummary.textContent(),
      "1 visible of 1 selected",
      "dashboard selection summary mirrors portfolio selection",
    );
  });
});
