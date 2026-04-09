import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TAuthErrorAssistant, TLoginAssistant, TSessionAssistant } from "../assistants/auth/index.js";
import type { TDashboardAssistant } from "../assistants/dashboard/index.js";
import type { TDividendsAssistant } from "../assistants/dividends/index.js";
import type { TAppShellAssistant } from "../assistants/layout/index.js";
import type { TPortfolioAssistant } from "../assistants/portfolio/index.js";
import type { TSettingsAssistant } from "../assistants/settings/index.js";
import type { TTickerDetailAssistant } from "../assistants/tickers/index.js";
import { AuthErrorPage, BrowserSessionPage, LoginPage } from "../pages/auth/index.js";
import { DashboardPage } from "../pages/dashboard/index.js";
import { DividendCalendarPage } from "../pages/dividends/index.js";
import { AppShellPage } from "../pages/layout/index.js";
import { PortfolioPage } from "../pages/portfolio/index.js";
import { SettingsDrawerPage } from "../pages/settings/index.js";
import { TickerDetailPage } from "../pages/tickers/index.js";

import { test as base } from "./oauthBase.js";

export interface TOAuthPagesFixtures {
  authError: TAuthErrorAssistant;
  appShell: TAppShellAssistant;
  dashboard: TDashboardAssistant;
  dividends: TDividendsAssistant;
  login: TLoginAssistant;
  portfolio: TPortfolioAssistant;
  session: TSessionAssistant;
  settings: TSettingsAssistant;
  ticker: TTickerDetailAssistant;
}

export const test = base.extend<TOAuthPagesFixtures>({
  login: createWebFixture<TLoginAssistant>(LoginPage),
  authError: createWebFixture<TAuthErrorAssistant>(AuthErrorPage),
  session: createWebFixture<TSessionAssistant>(BrowserSessionPage),
  dashboard: createWebFixture<TDashboardAssistant>(DashboardPage),
  dividends: createWebFixture<TDividendsAssistant>(DividendCalendarPage),
  appShell: createWebFixture<TAppShellAssistant>(AppShellPage),
  settings: createWebFixture<TSettingsAssistant>(SettingsDrawerPage),
  portfolio: createWebFixture<TPortfolioAssistant>(PortfolioPage),
  ticker: createWebFixture<TTickerDetailAssistant>(TickerDetailPage),
});

export { expect } from "./oauthBase.js";
