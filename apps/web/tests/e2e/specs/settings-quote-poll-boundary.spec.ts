import { expect, test } from "@playwright/test";
import { gotoApp, openSettingsDrawer } from "../helpers/flows";

test.use({
  extraHTTPHeaders: {
    "x-user-id": "e2e-settings-quote-boundary",
  },
});

test.describe("settings quote poll boundary", () => {
  test("blocks invalid quote poll save and avoids calling settings/full", async ({ page }) => {
    await gotoApp(page);
    await openSettingsDrawer(page);

    await page.getByTestId("settings-quote-poll-input").fill("0");
    await page.getByTestId("settings-save-button").click();

    const putRequested = await page
      .waitForRequest(
        (request) => request.method() === "PUT" && request.url().includes("/settings/full"),
        { timeout: 1200 },
      )
      .then(() => true)
      .catch(() => false);

    expect(putRequested).toBe(false);
    await expect(page).toHaveURL(/drawer=settings/);
    await expect(page.getByTestId("settings-quote-poll-input")).toHaveValue("0");
  });
});
