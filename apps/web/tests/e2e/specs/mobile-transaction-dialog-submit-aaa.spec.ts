import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

const MD_BREAKPOINT_PX = 768;

async function assertLocatorInsideViewport(page: Page, locator: Locator, label: string) {
  await locator.waitFor({ state: "visible" });
  await expect.poll(
    async () => {
      const box = await locator.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) return `${label} has no layout box`;
      const withinX = box.x >= -1 && box.x + box.width <= viewport.width + 1;
      const withinY = box.y >= -1 && box.y + box.height <= viewport.height + 1;
      return withinX && withinY
        ? "ready"
        : `${label} outside viewport (${box.x}, ${box.y}, ${box.width}, ${box.height}) vs ${viewport.width}x${viewport.height}`;
    },
    { message: `${label} is reachable inside the viewport` },
  ).toBe("ready");
}

test("[mobile-transaction-dialog-A]: add transaction dialog → submit remains reachable", async ({
  appShell,
  dashboard,
  page,
}) => {
  const viewport = page.viewportSize();
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(
    !viewport || viewport.width >= MD_BREAKPOINT_PX,
    "Mobile-only — verifies submit reachability in the constrained transaction dialog",
  );

  await appShell.actions.navigateToRouteForResponsiveTest("/dashboard");
  await dashboard.assert.floatingQuickActionsTriggerIsVisible();
  await dashboard.actions.openFloatingQuickActions();
  await dashboard.assert.floatingQuickActionsSheetIsVisible();
  await dashboard.actions.clickFloatingAddTransaction();

  const dialog = page.getByTestId("add-transaction-dialog");
  await dialog.waitFor({ state: "visible" });
  await assertLocatorInsideViewport(page, dialog, "add transaction dialog");

  const submitButton = dialog.getByTestId("tx-submit-button");
  await submitButton.scrollIntoViewIfNeeded();
  await assertLocatorInsideViewport(page, submitButton, "add transaction submit button");
});
