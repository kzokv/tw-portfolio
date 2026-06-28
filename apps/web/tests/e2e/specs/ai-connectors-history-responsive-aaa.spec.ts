import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { mockAiConnectorApi } from "./helpers/aiConnectorsMock";

test.describe("ai connector history desktop validation", () => {
  test("[ai connectors]: desktop History and Permissions layouts stay within viewport", async ({
    appShell,
    page,
  }) => {
    await mockAiConnectorApi(page);
    await appShell.actions.navigateToRoute("/settings/ai-connectors?section=history");
    await appShell.assert.appIsReady();

    await page.getByTestId("settings-ai-connectors-page").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-search").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-ended-filter").waitFor({ state: "visible" });

    const historyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (historyOverflow > 1) throw new Error(`History section has horizontal overflow: ${historyOverflow}px`);

    await page.screenshot({
      fullPage: true,
      path: "test-results/ai-connectors-history-desktop-validation.png",
    });

    await page.getByRole("button", { name: "Details" }).first().click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (detailOverflow > 1) throw new Error(`Connection detail sheet has horizontal overflow: ${detailOverflow}px`);
    await page.screenshot({
      fullPage: true,
      path: "test-results/ai-connectors-detail-desktop-validation.png",
    });
    await page.keyboard.press("Escape");

    await page.getByTestId("ai-connectors-tab-permissions").click();
    await page.getByText("Permissions").first().waitFor({ state: "visible" });

    const permissionsOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (permissionsOverflow > 1) throw new Error(`Permissions section has horizontal overflow: ${permissionsOverflow}px`);

    await page.screenshot({
      fullPage: true,
      path: "test-results/ai-connectors-permissions-desktop-validation.png",
    });
  });
});
