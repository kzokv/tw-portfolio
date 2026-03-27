import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TDashboardAssistant } from "../assistants/dashboard/index.js";
import type { TAppShellAssistant } from "../assistants/layout/index.js";
import type { TPortfolioAssistant } from "../assistants/portfolio/index.js";
import type { TSettingsAssistant } from "../assistants/settings/index.js";
import type { TTickerDetailAssistant } from "../assistants/tickers/index.js";
import type { TTransactionsAssistant } from "../assistants/transactions/index.js";
import { DashboardPage } from "../pages/dashboard/index.js";
import { AppShellPage } from "../pages/layout/index.js";
import { PortfolioPage } from "../pages/portfolio/index.js";
import { SettingsDrawerPage } from "../pages/settings/index.js";
import { TickerDetailPage } from "../pages/tickers/index.js";
import { TransactionsPage } from "../pages/transactions/index.js";

import { test as base } from "./base.js";

export interface TAppPagesFixtures {
  appShell: TAppShellAssistant;
  dashboard: TDashboardAssistant;
  portfolio: TPortfolioAssistant;
  settings: TSettingsAssistant;
  ticker: TTickerDetailAssistant;
  transactions: TTransactionsAssistant;
}

export const test = base.extend<TAppPagesFixtures>({
  appShell: createWebFixture<TAppShellAssistant>(AppShellPage),
  dashboard: createWebFixture<TDashboardAssistant>(DashboardPage),
  settings: createWebFixture<TSettingsAssistant>(SettingsDrawerPage),
  portfolio: createWebFixture<TPortfolioAssistant>(PortfolioPage),
  transactions: createWebFixture<TTransactionsAssistant>(TransactionsPage),
  ticker: createWebFixture<TTickerDetailAssistant>(TickerDetailPage),
});

export { expect } from "./base.js";
