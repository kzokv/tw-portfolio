import { publicPagesTest as test } from "@tw-portfolio/test-e2e/fixtures";

const UNKNOWN_TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

test.describe("anonymous public share: not found", () => {
  test("[anon public view]: invalid token visit → generic 404 page", async ({ anonymousShare }) => {
    await anonymousShare.actions.navigateToPublicShare(UNKNOWN_TOKEN);
    await anonymousShare.assert.notFoundStateIsVisible();
  });
});
