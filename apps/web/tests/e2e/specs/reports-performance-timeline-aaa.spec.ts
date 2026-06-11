import { expect } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("reports performance timeline controls", () => {
  test("[reports-timeline-A]: Portfolio report timeline changes without hiding performance state", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/reports?tab=portfolio&scope=all&range=1Y");
    await appShell.assert.appIsReady();

    const timeline = page.getByTestId("reports-performance-timeline");
    await timeline.waitFor({ state: "visible" });

    await timeline.getByRole("button", { name: "Week" }).click();
    await expect(timeline.getByRole("button", { name: "Week" })).toHaveAttribute("data-state", "on");

    await expect(
      page.getByTestId("reports-performance-chart")
        .or(page.getByText("No server snapshot series is available for this scope."))
        .first(),
    ).toBeVisible();
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("reports-controls").getByText("Range").count(),
      1,
      "Reports page keeps the report range control outside the performance card",
    );
  });
});
