import { request as apiRequest, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
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

async function assertWithinViewport(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    throw new Error(`Could not measure ${label}`);
  }
  const right = box.x + box.width;
  if (box.x < -1 || right > viewport.width + 1) {
    throw new Error(`${label} overflows viewport: x=${box.x}, right=${right}, width=${viewport.width}`);
  }
}

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function browserCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const authCookies = cookies.filter((cookie) => (
    cookie.name === TestEnv.sessionCookieName
    || cookie.name === "tw_e2e_user"
    || cookie.name === "tw_e2e_user_role"
  ));
  if (authCookies.length === 0) {
    throw new Error("No browser auth cookies found for API seeding");
  }
  return authCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function executeAdminMarketDataAction(
  page: Page,
  marketCode: "TW" | "KR",
  payload: Record<string, unknown>,
): Promise<{ operationId: string }> {
  const cookie = await browserCookieHeader(page);
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath(`/admin/market-data/${marketCode}/actions/execute`), {
      headers: { cookie },
      data: {
        acknowledged: true,
        ...payload,
      },
    });
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`admin action failed: ${response.status()} ${text}`);
    }
    return JSON.parse(text) as { operationId: string };
  });
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

  test("[admin-market-data]: activity row opens drawer only after an instrument action creates activity", async ({
    appShell,
    page,
    settings,
  }) => {
    const activityTicker = uniqueTicker("ACT");
    await settings.arrange.seedInstruments([
      {
        ticker: activityTicker,
        name: "Activity Drawer E2E",
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "pending",
      },
    ]);

    await appShell.actions.navigateToRoute(`/admin/market-data/AU/instruments?search=${activityTicker}`);
    await appShell.assert.appIsReady();
    await page.getByTestId(`market-data-instrument-row-${activityTicker}`).click();
    const instrumentDrawer = page.getByTestId("ui-drawer");
    await instrumentDrawer.getByText("Support controls").waitFor({ state: "visible" });
    await instrumentDrawer.getByRole("button", { name: "retired_by_admin" }).click();
    await instrumentDrawer.getByRole("definition").filter({ hasText: "retired_by_admin" }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");

    await appShell.actions.navigateToRoute(`/admin/market-data/AU/activity?search=${activityTicker}&timeRange=all`);
    await appShell.assert.appIsReady();
    await page.getByTestId("market-data-activity").waitFor({ state: "visible" });
    await assertNoDrawer(page.getByTestId("ui-drawer"));
    await page.locator("[data-testid^='activity-row-']").first().click();
    const activityDrawer = page.getByTestId("ui-drawer");
    await activityDrawer.waitFor({ state: "visible" });
    await assertText(activityDrawer, /instrument|support|activity|狀態|活動/i);
  });

  test("[admin-market-data]: generic operations drawer stays closed until row tap", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/");
    await appShell.assert.appIsReady();
    const { operationId } = await executeAdminMarketDataAction(page, "TW", {
      action: "sync_catalog",
      providerId: "finmind-tw",
    });

    await appShell.actions.navigateToRoute("/admin/market-data/TW/operations");
    await appShell.assert.appIsReady();
    await page.getByTestId("market-data-operations").waitFor({ state: "visible" });
    await assertNoDrawer(page.getByTestId("ui-drawer"));
    await page.getByTestId(`market-data-operation-row-${operationId}`).click();
    const drawer = page.getByTestId("ui-drawer");
    await drawer.waitFor({ state: "visible" });
    await assertText(drawer, new RegExp(operationId));
  });

  test("[admin-market-data]: KR operations do not auto-open without operationId", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/");
    await appShell.assert.appIsReady();
    const { operationId } = await executeAdminMarketDataAction(page, "KR", {
      action: "repair_mapping",
      providerId: "yahoo-finance-kr",
      resolverMode: "quote_first",
    });

    await appShell.actions.navigateToRoute("/admin/market-data/KR/operations");
    await appShell.assert.appIsReady();
    await page.getByTestId("market-data-kr-operations").waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      new URL(page.url()).searchParams.get("operationId"),
      null,
      "KR operations route has no operationId before row tap",
    );
    await assertNoDrawer(page.getByTestId("ui-drawer"));
    await page.locator("[data-testid='provider-console-operations-table'] > [data-hydrated='true']").waitFor({ state: "visible" });
    await page.getByTestId(`provider-console-operation-select-${operationId}`).click();
    await page.waitForURL((url) => url.searchParams.get("operationId") === operationId);
    const drawer = page.getByTestId("ui-drawer");
    await drawer.waitFor({ state: "visible" });
    await assertText(drawer, new RegExp(operationId));
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

  test("[ai-connectors]: mobile dropdown reaches MCP Tools without horizontal overflow", async ({
    appShell,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await appShell.actions.navigateToRoute("/settings/ai-connectors");
    await appShell.assert.appIsReady();
    await page.getByTestId("settings-ai-connectors-page").waitFor({ state: "visible" });

    await page.getByTestId("ai-connectors-mobile-tab-select").click();
    await page.getByRole("option", { name: /MCP Tools|MCP 工具/ }).click();
    await page.getByTestId("ai-connectors-tool-search").waitFor({ state: "visible" });

    await assertWithinViewport(page, page.getByTestId("settings-ai-connectors-page"), "AI Connectors page");
    await assertWithinViewport(page, page.getByTestId("ai-connectors-mobile-tab-select"), "AI Connectors mobile tab select");
    await assertWithinViewport(page, page.getByTestId("ai-connectors-tool-search"), "AI Connectors tool search");
    await assertWithinViewport(page, page.getByTestId("ai-connectors-tool-group-filter"), "AI Connectors tool group filter");
    await assertWithinViewport(page, page.getByTestId("ai-connectors-tool-availability-filter"), "AI Connectors tool availability filter");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await appShell.assert.mxAssertEqual(overflow, false, "AI Connectors mobile layout has no horizontal overflow");
  });
});
