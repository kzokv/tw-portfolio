import { test as base } from "@playwright/test";
import { ROUTES, TEST_DATA } from "../constants/index.js";
import {
  buildUserFixtures,
  prewarmAppRoute,
  type TBaseFixtures,
} from "./shared.js";

export const test = base.extend<TBaseFixtures>({
  page: async ({ page, request }, use) => {
    await Promise.all([
      prewarmAppRoute(request, ROUTES.DASHBOARD),
      prewarmAppRoute(request, ROUTES.SETTINGS_DRAWER),
      prewarmAppRoute(request, ROUTES.PORTFOLIO),
      prewarmAppRoute(request, ROUTES.TRANSACTIONS),
      prewarmAppRoute(request, `/tickers/${TEST_DATA.TICKER_SYMBOL}`),
    ]);
    await use(page);
  },
  ...buildUserFixtures(true),
});

export { expect } from "@playwright/test";
