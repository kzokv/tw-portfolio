import { expect, test } from "@playwright/test";
import { gotoApp, openSettingsDrawer } from "../helpers/flows";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test.use({
  extraHTTPHeaders: {
    "x-user-id": "e2e-settings-weighted",
  },
});

test.describe("settings weighted-average only", () => {
  test("keeps weighted average as the only cost basis option and submits it in payload", async ({ page }) => {
    await gotoApp(page);
    await openSettingsDrawer(page);

    const costBasisSelect = page.getByTestId("settings-cost-basis-select");
    const options = costBasisSelect.locator("option");

    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAttribute("value", "WEIGHTED_AVERAGE");
    await expect(options.first()).toContainText(/Weighted Average|加權平均/);

    const currentQuotePoll = await page.getByTestId("settings-quote-poll-input").inputValue();
    await page.getByTestId("settings-quote-poll-input").fill(getNextQuotePoll(currentQuotePoll));

    const settingsSaved = page.waitForResponse((response) => {
      return response.request().method() === "PUT" && response.url().includes("/settings/full") && response.ok();
    });
    await page.getByTestId("settings-save-button").click();
    const saveResponse = await settingsSaved;

    const requestPayload = saveResponse.request().postDataJSON() as {
      settings: { costBasisMethod: string };
    };
    expect(requestPayload.settings.costBasisMethod).toBe("WEIGHTED_AVERAGE");

    await expect(page).not.toHaveURL(/drawer=settings/, { timeout: 15_000 });
    await expect(page.getByTestId("settings-cost-basis-value")).toContainText(/Weighted Average|加權平均/);

    await page.reload();
    await expect(page.getByTestId("settings-cost-basis-value")).toContainText(/Weighted Average|加權平均/, {
      timeout: 30_000,
    });
  });
});
