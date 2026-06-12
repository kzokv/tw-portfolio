import { publicPagesTest as test } from "@vakwen/test-e2e/fixtures";
import {
  assertNoBodyOverflow,
  assertWithinViewport,
  seedResponsivePublicShareToken,
} from "./public-share-fit-helpers.js";

test("[mobile-fit-public-share-A]: validate public share detail -> stays visible without page overflow", async ({
  anonymousShare,
  page,
}) => {
  const token = await seedResponsivePublicShareToken({
    email: "public-share-fit-mobile@example.com",
    name: "Public Share Fit Mobile",
    sub: "public-share-fit-mobile-sub",
    ticker: "6892",
  });

  await anonymousShare.actions.navigateToPublicShare(token);
  await anonymousShare.assert.rootIsVisible();
  await page.getByTestId("public-share-holdings-table").waitFor({ state: "visible" });

  await assertWithinViewport(page, "public-share-header");
  await assertWithinViewport(page, "public-share-holdings");
  await assertNoBodyOverflow(page);
});
