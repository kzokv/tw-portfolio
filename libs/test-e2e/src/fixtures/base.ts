import { test as base } from "@playwright/test";
import {
  buildUserFixtures,
  prewarmAppRoute,
  type TBaseFixtures,
} from "./shared.js";

export const test = base.extend<TBaseFixtures>({
  page: async ({ page, request }, use) => {
    await Promise.all([
      prewarmAppRoute(request, "/dashboard"),
      prewarmAppRoute(request, "/dashboard?drawer=settings"),
      prewarmAppRoute(request, "/portfolio"),
      prewarmAppRoute(request, "/transactions"),
      prewarmAppRoute(request, "/tickers/2330"),
    ]);
    await use(page);
  },
  ...buildUserFixtures(true),
});

export { expect } from "@playwright/test";
