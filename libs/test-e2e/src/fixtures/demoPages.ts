import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TSessionAssistant } from "../assistants/auth/index.js";
import type { TDashboardAssistant } from "../assistants/dashboard/index.js";
import type { TPortfolioAssistant } from "../assistants/portfolio/index.js";
import type { TTickerDetailAssistant } from "../assistants/tickers/index.js";
import { BrowserSessionPage } from "../pages/auth/index.js";
import { DashboardPage } from "../pages/dashboard/index.js";
import { PortfolioPage } from "../pages/portfolio/index.js";
import { TickerDetailPage } from "../pages/tickers/index.js";

import { test as base } from "./demoBase.js";

export interface TDemoPagesFixtures {
  dashboard: TDashboardAssistant;
  portfolio: TPortfolioAssistant;
  session: TSessionAssistant;
  ticker: TTickerDetailAssistant;
}

export const test = base.extend<TDemoPagesFixtures>({
  session: createWebFixture<TSessionAssistant>(BrowserSessionPage),
  dashboard: createWebFixture<TDashboardAssistant>(DashboardPage),
  portfolio: createWebFixture<TPortfolioAssistant>(PortfolioPage),
  ticker: createWebFixture<TTickerDetailAssistant>(TickerDetailPage),
});

export { expect } from "./demoBase.js";
