import { expect } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/oauthPages";

test.describe("dashboard shared timeline controls", () => {
  test("[dashboard-timeline-A]: Portfolio Trend timeline change mirrors into Return %", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();

    const trendTimeline = page.getByTestId("dashboard-performance-timeline");
    const returnTimeline = page.getByTestId("dashboard-return-percent-timeline");
    await trendTimeline.waitFor({ state: "visible" });
    await returnTimeline.waitFor({ state: "visible" });

    await trendTimeline.getByRole("button", { name: "Month" }).click();

    await expect.poll(
      async () => ({
        trend: await trendTimeline.getByRole("button", { name: "Month" }).getAttribute("data-state"),
        returns: await returnTimeline.getByRole("button", { name: "Month" }).getAttribute("data-state"),
      }),
      { timeout: 5_000, intervals: [200, 400] },
    ).toEqual({ trend: "on", returns: "on" });

    await trendTimeline.getByRole("button", { name: "Year" }).click();
    await expect.poll(
      async () => returnTimeline.getByRole("button", { name: "Year" }).getAttribute("data-state"),
      { timeout: 5_000, intervals: [200, 400] },
    ).toBe("on");
  });
});
