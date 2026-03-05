import { expect, test } from "@playwright/test";
import { gotoApp, openSettingsDrawer } from "../helpers/flows";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test.use({
  extraHTTPHeaders: {
    "x-user-id": "e2e-settings-failure",
  },
});

test.describe("settings save failure", () => {
  test("keeps drawer open and blocks partial UI commit when save fails", async ({ page }) => {
    await gotoApp(page);
    const heroTitleBefore = await page.getByTestId("hero-title").textContent();

    await page.route("**/settings/full", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced settings save failure for e2e" }),
      });
    });

    await openSettingsDrawer(page);
    await page.getByTestId("settings-locale-select").selectOption("zh-TW");
    const currentQuotePoll = await page.getByTestId("settings-quote-poll-input").inputValue();
    await page.getByTestId("settings-quote-poll-input").fill(getNextQuotePoll(currentQuotePoll));
    await page.getByTestId("settings-save-button").click();

    await expect(page).toHaveURL(/drawer=settings/);
    await expect(page.getByTestId("settings-validation-error")).toBeVisible();
    await expect(page.getByTestId("hero-title")).toHaveText(heroTitleBefore ?? "");
  });
});
