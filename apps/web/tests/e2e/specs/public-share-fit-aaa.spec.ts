import { publicPagesTest as test } from "@vakwen/test-e2e/fixtures";
import {
  assertNoBodyOverflow,
  assertWithinViewport,
  seedResponsivePublicShareToken,
} from "./public-share-fit-helpers.js";

test("[desktop-fit-public-share-A]: validate public share detail -> stays visible without page overflow", async ({
  anonymousShare,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const token = await seedResponsivePublicShareToken({
    email: "public-share-fit-desktop@example.com",
    name: "Public Share Fit Desktop",
    sub: "public-share-fit-desktop-sub",
    ticker: "6891",
  });

  await anonymousShare.actions.navigateToPublicShare(token);
  await anonymousShare.assert.rootIsVisible();
  await page.getByTestId("public-share-holdings-table").waitFor({ state: "visible" });

  await assertWithinViewport(page, "public-share-header");
  await assertWithinViewport(page, "public-share-holdings");
  await assertNoBodyOverflow(page);
});
