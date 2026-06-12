import type { Page } from "@playwright/test";
import {
  seedQuoteBars,
  seedSingleAnonymousShareToken,
} from "./helpers/anonymousShare.js";
import { seedTransactionForUser, seedUser } from "./helpers/sharing.js";

export async function seedResponsivePublicShareToken({
  email,
  name,
  sub,
  ticker,
}: {
  email: string;
  name: string;
  sub: string;
  ticker: string;
}): Promise<string> {
  const owner = await seedUser({ email, name, sub, role: "member" });
  await seedTransactionForUser(owner.userId, {
    ticker,
    quantity: 12,
    unitPrice: 250,
    tradeDate: "2026-02-03",
  });
  await seedQuoteBars([
    {
      ticker,
      barDate: "2026-05-15",
      open: 310,
      high: 310,
      low: 310,
      close: 310,
      volume: 1000,
    },
  ]);
  const token = await seedSingleAnonymousShareToken({
    ownerUserId: owner.userId,
    expiresInDays: 30,
  });
  return token.token;
}

export async function assertNoBodyOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollWidth > clientWidth + 1) {
    throw new Error(`body scroll-width (${scrollWidth}) exceeds viewport width (${clientWidth})`);
  }
}

export async function assertWithinViewport(page: Page, testId: string) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box) throw new Error(`${testId} has no layout box`);
  if (!viewport) throw new Error("viewport is unavailable");
  if (box.x < -1) throw new Error(`${testId} left edge is outside viewport: ${box.x}`);
  if (box.x + box.width > viewport.width + 1) {
    throw new Error(`${testId} right edge ${box.x + box.width} exceeds viewport width ${viewport.width}`);
  }
}
