import { publicPagesTest as test } from "@tw-portfolio/test-e2e/fixtures";
import {
  seedSingleAnonymousShareToken,
  seedQuoteBars,
} from "./helpers/anonymousShare.js";
import { seedTransactionForUser, seedUser } from "./helpers/sharing.js";

// NOTE: seedQuoteBars appends to a global (non-per-user) array in MemoryPersistence.
// Use tickers not shared with other E2E specs (6770, 5880, 6669) to prevent
// cross-test quote-bar contamination (e.g. dashboard-daily-change-aaa expects
// "2330" to have NO bars; seeding 2330 here would break that suite).

test.describe("anonymous public share: rendered page", () => {
  test("[anon public view]: unauthenticated visit renders holdings + summary → no cost basis and noindex meta", async ({
    anonymousShare,
  }) => {
    const owner = await seedUser({
      sub: "anon-public-e2e-owner-sub",
      email: "anon-public-e2e-owner@example.com",
      name: "Anon Public E2E Owner",
      role: "member",
    });

    await seedTransactionForUser(owner.userId, {
      ticker: "6770",
      quantity: 100,
      unitPrice: 500,
      tradeDate: "2026-01-02",
    });
    await seedTransactionForUser(owner.userId, {
      ticker: "5880",
      quantity: 10,
      unitPrice: 800,
      tradeDate: "2026-01-03",
    });
    await seedTransactionForUser(owner.userId, {
      ticker: "6669",
      quantity: 3,
      unitPrice: 30,
      tradeDate: "2026-01-04",
    });
    await seedTransactionForUser(owner.userId, {
      ticker: "6669",
      quantity: 3,
      unitPrice: 35,
      tradeDate: "2026-01-05",
      type: "SELL",
    });
    await seedQuoteBars([
      {
        ticker: "6770",
        barDate: "2026-04-18",
        open: 610,
        high: 610,
        low: 610,
        close: 610,
        volume: 1000,
      },
      {
        ticker: "5880",
        barDate: "2026-04-18",
        open: 920,
        high: 920,
        low: 920,
        close: 920,
        volume: 1000,
      },
      {
        ticker: "6669",
        barDate: "2026-04-18",
        open: 10,
        high: 10,
        low: 10,
        close: 10,
        volume: 1000,
      },
    ]);

    const token = await seedSingleAnonymousShareToken({
      ownerUserId: owner.userId,
      expiresInDays: 30,
    });

    await anonymousShare.actions.navigateToPublicShare(token.token);
    await anonymousShare.assert.rootIsVisible();
    await anonymousShare.assert.headerIsVisible();
    await anonymousShare.assert.ownerNameContains("Anon Public E2E Owner");
    await anonymousShare.assert.metaIsVisible();
    await anonymousShare.assert.totalValueIsVisible();
    await anonymousShare.assert.totalReturnIsVisible();
    await anonymousShare.assert.holdingsSectionIsVisible();
    await anonymousShare.assert.holdingRowVisible("6770");
    await anonymousShare.assert.holdingRowVisible("5880");
    await anonymousShare.assert.holdingRowHidden("6669");
    await anonymousShare.assert.disclosureIsVisible();
    await anonymousShare.assert.domDoesNotContainCostBasis();
    await anonymousShare.assert.robotsMetaIsNoIndexNoFollow();
    await anonymousShare.assert.totalValueByCurrencyIsVisible("TWD");
  });
});
