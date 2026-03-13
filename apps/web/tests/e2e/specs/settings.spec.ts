import { test, expect } from "../fixtures/test";
import { gotoRoute, openSettingsDrawer, waitForAppReady } from "../helpers/flows";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test("settings persist across routes and reloads for the same seeded user", async ({ page }) => {
  await gotoRoute(page, "/portfolio");
  await openSettingsDrawer(page);

  await page.getByTestId("settings-locale-select").selectOption("zh-TW");
  const currentQuotePoll = await page.getByTestId("settings-quote-poll-input").inputValue();
  const nextQuotePoll = getNextQuotePoll(currentQuotePoll);
  await page.getByTestId("settings-quote-poll-input").fill(nextQuotePoll);

  const settingsSaved = page.waitForResponse((response) =>
    response.request().method() === "PUT" && response.url().includes("/settings/full") && response.ok());

  await page.getByTestId("settings-save-button").click();
  await settingsSaved;

  await expect(page).not.toHaveURL(/drawer=settings/);
  await expect(page.getByTestId("topbar-title")).toContainText("持倉");

  await page.getByTestId("desktop-sidebar").getByTestId("sidebar-link-dashboard").click();
  await expect(page).toHaveURL(/\/$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("topbar-title")).toContainText("儀表板");
  await expect(page.getByTestId("settings-quote-poll-value")).toContainText(`${nextQuotePoll} 秒`);

  await page.reload();
  await waitForAppReady(page);
  await expect(page.getByTestId("topbar-title")).toContainText("儀表板");
  await expect(page.getByTestId("settings-quote-poll-value")).toContainText(`${nextQuotePoll} 秒`);
});

test("invalid settings keep the drawer open and surface validation", async ({ page }) => {
  await gotoRoute(page, "/transactions");
  await openSettingsDrawer(page);
  await page.getByTestId("settings-tab-fees").click();

  await page.getByTestId("settings-add-profile-button").click();
  const profileCount = await page.locator('[data-testid^="settings-profile-name-"]').count();
  const newProfileIndex = profileCount - 1;
  await page.getByTestId(`settings-profile-name-${newProfileIndex}`).fill("");

  await page.getByTestId("settings-save-button").click();

  await expect(page).toHaveURL(/drawer=settings/);
  await expect(page.getByTestId("settings-validation-error")).toBeVisible();
  await expect(page.getByTestId("settings-drawer")).toBeVisible();
});
