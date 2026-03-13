import { test, expect } from "../fixtures/test";
import { gotoRoute } from "../helpers/flows";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test("settings tooltips and unsaved-changes warning remain accessible", async ({ page }) => {
  await gotoRoute(page, "/portfolio?drawer=settings");

  await expect(page.getByTestId("settings-drawer")).toBeVisible();
  await page.getByTestId("tooltip-settings-locale-trigger").hover();
  await expect(page.getByTestId("tooltip-settings-locale-content")).toBeVisible();

  await page.getByTestId("tooltip-settings-cost-basis-trigger").focus();
  await expect(page.getByTestId("tooltip-settings-cost-basis-content")).toBeVisible();

  const currentQuotePoll = await page.getByTestId("settings-quote-poll-input").inputValue();
  await page.getByTestId("settings-quote-poll-input").fill(getNextQuotePoll(currentQuotePoll));

  await page.getByRole("button", { name: /Cancel|取消/ }).click();
  await expect(page.getByTestId("settings-close-warning")).toBeVisible();

  await page.getByRole("button", { name: /Keep Editing|繼續編輯/ }).click();
  await page.getByTestId("settings-discard-button").click();
  await expect(page.getByTestId("settings-discard-notice")).toContainText(/discarded|捨棄/);
});

test("transaction tooltips and shell controls stay focusable", async ({ page }) => {
  await gotoRoute(page, "/transactions");

  await expect(page.getByTestId("topbar-search")).toBeVisible();
  await page.getByTestId("avatar-button").focus();
  await expect(page.getByTestId("avatar-button")).toBeFocused();

  await page.getByTestId("tooltip-tx-account-trigger").hover();
  await expect(page.getByTestId("tooltip-tx-account-content")).toBeVisible();
});
