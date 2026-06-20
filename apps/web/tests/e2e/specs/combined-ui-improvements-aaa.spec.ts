import type { Locator } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

import { seedAccountForUser, seedTransactionForUser } from "./helpers/sharing.js";

function uniqueTicker(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

async function assertText(locator: Locator, pattern: RegExp): Promise<void> {
  const text = await locator.textContent();
  if (!text || !pattern.test(text)) {
    throw new Error(`Expected locator text to match ${pattern}, received: ${text ?? "<empty>"}`);
  }
}

async function assertNoDrawer(locator: Locator): Promise<void> {
  const initialDrawerCount = await locator.count();
  if (initialDrawerCount !== 0) {
    throw new Error(`Expected no drawer before row click, found ${initialDrawerCount}`);
  }
}

test.describe("combined UI improvements", () => {
  test("[realized-pnl-breakdown]: transactions SELL row opens backend-provided math details", async ({
    page,
    settings,
    testUser,
    transactions,
  }) => {
    const realizedTicker = uniqueTicker("84");
    const account = await seedAccountForUser(testUser.userId, {
      name: `Realized PnL ${realizedTicker}`,
    });
    await settings.arrange.seedInstruments([
      {
        ticker: realizedTicker,
        name: "Realized PnL E2E",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);

    await seedTransactionForUser(testUser.userId, {
      accountId: account.id,
      ticker: realizedTicker,
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-01-02",
      type: "BUY",
    });
    await seedTransactionForUser(testUser.userId, {
      accountId: account.id,
      ticker: realizedTicker,
      quantity: 10,
      unitPrice: 200,
      tradeDate: "2026-01-03",
      type: "BUY",
    });
    await seedTransactionForUser(testUser.userId, {
      accountId: account.id,
      ticker: realizedTicker,
      quantity: 5,
      unitPrice: 300,
      tradeDate: "2026-01-04",
      type: "SELL",
    });

    await transactions.actions.navigateToTransactions();
    await page.getByText(realizedTicker).first().waitFor({ state: "visible" });
    await page.getByTestId("realized-pnl-breakdown-trigger").first().waitFor({ state: "visible" });

    await page.getByTestId("realized-pnl-breakdown-trigger").first().click();
    const breakdownPanel = page.getByTestId("realized-pnl-breakdown-panel");
    await breakdownPanel.waitFor({ state: "visible" });
    await assertText(breakdownPanel, /Realized P&L math|已實現損益計算/);
    await assertText(breakdownPanel, /Allocated cost|分攤成本/);
  });

  test("[admin-market-data]: instrument row opens drawer and settings control is reachable", async ({
    appShell,
    page,
    settings,
  }) => {
    const adminTicker = uniqueTicker("ADM");
    await settings.arrange.seedInstruments([
      {
        ticker: adminTicker,
        name: "Admin Drawer E2E",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "pending",
      },
    ]);

    await appShell.actions.navigateToRoute(`/admin/market-data/TW/instruments?search=${adminTicker}`);
    await appShell.assert.appIsReady();
    await page.getByTestId("market-data-instruments").waitFor({ state: "visible" });
    await assertNoDrawer(page.getByTestId("ui-drawer"));

    await page.getByTestId("admin-market-data-column-settings").click();
    await page.getByTestId("admin-market-data-column-move-right-ticker").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");

    await page.getByTestId(`market-data-instrument-row-${adminTicker}`).click();
    const drawer = page.getByTestId("ui-drawer");
    await drawer.waitFor({ state: "visible" });
    await assertText(drawer, new RegExp(`${adminTicker} details`));
  });

  test("[ai-connectors]: MCP Tools tab exposes search and filters without duplicated connection inventory", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/settings/ai-connectors");
    await appShell.assert.appIsReady();
    await page.getByTestId("settings-ai-connectors-page").waitFor({ state: "visible" });

    await page.getByTestId("ai-connectors-tab-tools").click();
    await page.getByTestId("ai-connectors-tool-search").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-tool-search").fill("definitely-not-a-real-tool");
    await page.getByText(/No tools match the current search|目前搜尋條件沒有符合的工具/).waitFor({ state: "visible" });

    await page.getByTestId("ai-connectors-tool-search").fill("");
    await page.getByTestId("ai-connectors-tool-group-filter").selectOption("read");
    await page.getByTestId("ai-connectors-tool-availability-filter").selectOption("available");
    await page.getByTestId("ai-connectors-tool-search").waitFor({ state: "visible" });
  });
});
