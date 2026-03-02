import { expect, test } from "@playwright/test";
import { gotoApp, openSettingsDrawer } from "../helpers/flows";

const getNextQuotePoll = (current: string): string =>
  current === "12" ? "10" : "12";

const uniqueProfileName = (): string => `E2E Profile ${Date.now()}`;

test.describe("transaction flow", () => {
  test("add transaction and verify holdings", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId("hero-title")).toContainText(/Taiwan Portfolio Control Room|台灣投資組合控制台/);
    const accountSelect = page.getByTestId("tx-account-select");
    const firstAccountOption = accountSelect.locator("option").first();
    await expect(firstAccountOption).toHaveAttribute("value", /.+/);
    const firstAccountId = await firstAccountOption.evaluate((option) => option.getAttribute("value"));
    await accountSelect.selectOption(firstAccountId!);
    await expect(page.getByTestId("tx-submit-button")).toBeEnabled();

    const transactionPosted = page.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        response.url().includes("/portfolio/transactions") &&
        response.ok()
      );
    });
    const holdingsRefreshed = page.waitForResponse((response) => {
      return (
        response.request().method() === "GET" &&
        response.url().includes("/portfolio/holdings") &&
        response.ok()
      );
    });

    await page.getByTestId("tx-submit-button").click();
    await transactionPosted;
    await holdingsRefreshed;
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("holdings-table").getByText("2330")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("recompute flow", () => {
  test("recompute history with fallback confirmation", async ({ page }) => {
    await gotoApp(page);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("recompute-button").click();

    await expect(page.getByTestId("recompute-button")).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("recompute-status")).toContainText(/Recompute CONFIRMED|重算已確認/, { timeout: 5_000 });
  });
});

test.describe("settings", () => {
  test("update locale and translate full UI", async ({ page }) => {
    await gotoApp(page);
    await openSettingsDrawer(page);

    await page.getByTestId("settings-locale-select").selectOption("zh-TW");
    await page.getByTestId("settings-cost-basis-select").selectOption("LIFO");
    const currentQuotePoll = await page.getByTestId("settings-quote-poll-input").inputValue();
    const nextQuotePoll = getNextQuotePoll(currentQuotePoll);
    await page.getByTestId("settings-quote-poll-input").fill(nextQuotePoll);
    await page.getByTestId("settings-save-button").click();

    await expect(page).not.toHaveURL(/drawer=settings/, { timeout: 15_000 });
    await expect(page.getByTestId("hero-title")).toContainText("台灣投資組合控制台", { timeout: 5_000 });
    await expect(page.getByTestId("topbar-title")).toContainText("市場帳本");
    await expect(page.getByTestId("settings-quote-poll-value")).toContainText(`${nextQuotePoll} 秒`);
    await expect(page.getByTestId("settings-cost-basis-value")).toContainText("LIFO");

    await page.reload();
    await expect(page.getByTestId("hero-title")).toContainText("台灣投資組合控制台", { timeout: 10_000 });
    await expect(page.getByTestId("topbar-title")).toContainText("市場帳本");
  });

  test("save fee profile changes and persist them after reload", async ({ page }) => {
    await gotoApp(page);
    await openSettingsDrawer(page);
    await page.getByTestId("settings-tab-fees").click();

    const profileName = uniqueProfileName();
    const bindingSymbol = `QA${String(Date.now()).slice(-4)}`;
    const accountSelect = page.locator('[data-testid^="settings-account-profile-"]').first();

    await page.getByTestId("settings-add-profile-button").click();
    const profileCount = await page.locator('[data-testid^="settings-profile-name-"]').count();
    const newProfileIndex = profileCount - 1;

    await page.getByTestId(`settings-profile-name-${newProfileIndex}`).fill(profileName);
    await accountSelect.selectOption({ label: profileName });

    await page.getByTestId("settings-add-binding-button").click();
    const bindingCount = await page.locator('[data-testid^="settings-binding-row-"]').count();
    const newBindingIndex = bindingCount - 1;

    await page.getByTestId(`settings-binding-symbol-${newBindingIndex}`).fill(bindingSymbol);
    await page.getByTestId(`settings-binding-profile-${newBindingIndex}`).selectOption({ label: profileName });

    const settingsSaved = page.waitForResponse((response) => {
      return response.request().method() === "PUT" && response.url().includes("/settings/full") && response.ok();
    });

    await page.getByTestId("settings-save-button").click();
    await settingsSaved;

    await expect(page).not.toHaveURL(/drawer=settings/, { timeout: 15_000 });

    await page.reload();
    await openSettingsDrawer(page);
    await page.getByTestId("settings-tab-fees").click();

    await expect(page.getByTestId(`settings-profile-name-${newProfileIndex}`)).toHaveValue(profileName);
    const savedAccountProfileId = await accountSelect.inputValue();
    await expect(accountSelect).toHaveValue(savedAccountProfileId);

    const bindingSymbols = page.locator('[data-testid^="settings-binding-symbol-"]');
    const bindingProfiles = page.locator('[data-testid^="settings-binding-profile-"]');
    const bindingInputsCount = await bindingSymbols.count();
    let matchedBindingIndex = -1;

    for (let index = 0; index < bindingInputsCount; index += 1) {
      if ((await bindingSymbols.nth(index).inputValue()) === bindingSymbol) {
        matchedBindingIndex = index;
        break;
      }
    }

    expect(matchedBindingIndex).toBeGreaterThanOrEqual(0);
    await expect(bindingSymbols.nth(matchedBindingIndex)).toHaveValue(bindingSymbol);
    await expect(bindingProfiles.nth(matchedBindingIndex)).toHaveValue(savedAccountProfileId);
  });

  test("blocks invalid settings saves and keeps the drawer open", async ({ page }) => {
    await gotoApp(page);
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
});

test.describe("tooltips", () => {
  test("settings and domain term tooltips are visible", async ({ page }) => {
    await gotoApp(page, "/?drawer=settings");

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

  test("critical flow: settings and term tooltips are visible", async ({ page }) => {
    await gotoApp(page, "/?drawer=settings");

    await expect(page.getByTestId("settings-drawer")).toBeVisible();

    await page.getByTestId("tooltip-settings-locale-trigger").hover();
    await expect(page.getByTestId("tooltip-settings-locale-content")).toBeVisible();

    await page.getByTestId("tooltip-settings-cost-basis-trigger").focus();
    await expect(page.getByTestId("tooltip-settings-cost-basis-content")).toBeVisible();

    await page.getByTestId("tooltip-fifo-trigger").hover();
    await expect(page.getByTestId("tooltip-fifo-content")).toBeVisible();

    await gotoApp(page);
    await page.getByTestId("tooltip-tx-account-trigger").hover();
    await expect(page.getByTestId("tooltip-tx-account-content")).toBeVisible();
  });
});

test("responsive: key UI visible at 375px with English locale", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await gotoApp(page);

  await expect(page.getByTestId("topbar-title")).toBeVisible();
  await expect(page.getByTestId("hero-title")).toContainText(/Taiwan Portfolio Control Room|台灣投資組合控制台/);
  await expect(page.getByTestId("recompute-button")).toBeVisible();
  await expect(page.getByTestId("avatar-button")).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});

test("responsive: settings drawer remains usable at 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoApp(page);
  await openSettingsDrawer(page);
  await page.getByTestId("settings-tab-fees").click();

  const drawerBox = await page.getByTestId("settings-drawer").boundingBox();
  expect(drawerBox?.width ?? 0).toBeGreaterThanOrEqual(840);

  const scrollMetrics = await page.getByTestId("settings-content-scroll").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));

  expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth + 2);
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

  await expect(page.getByTestId("settings-add-profile-button")).toBeVisible();
  await page.getByTestId("settings-add-binding-button").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("settings-add-binding-button")).toBeVisible();
});
