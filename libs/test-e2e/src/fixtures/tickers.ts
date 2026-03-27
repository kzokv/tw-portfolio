import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TTickerDetailAssistant } from "../assistants/tickers/index.js";
import { TickerDetailPage } from "../pages/tickers/TickerDetailPage.js";

import { test as base } from "./appShell.js";

export interface TTickerDetailFixtures {
  ticker: TTickerDetailAssistant;
}

export const test = base.extend<TTickerDetailFixtures>({
  ticker: createWebFixture<TTickerDetailAssistant>(TickerDetailPage),
});

export { expect } from "./appShell.js";
