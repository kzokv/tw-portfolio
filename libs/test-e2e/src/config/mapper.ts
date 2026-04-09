import { webAssistantRegistry } from "@tw-portfolio/test-framework/config";

import { authErrorAssistantFactory, loginAssistantFactory, sessionAssistantFactory } from "../assistants/auth/index.js";
import { dashboardAssistantFactory } from "../assistants/dashboard/index.js";
import { dividendsAssistantFactory } from "../assistants/dividends/index.js";
import { appShellAssistantFactory } from "../assistants/layout/index.js";
import { portfolioAssistantFactory } from "../assistants/portfolio/index.js";
import { settingsAssistantFactory } from "../assistants/settings/index.js";
import { tickerDetailAssistantFactory } from "../assistants/tickers/index.js";
import { transactionsAssistantFactory } from "../assistants/transactions/index.js";
import { AuthErrorPage } from "../pages/auth/AuthErrorPage.js";
import { BrowserSessionPage } from "../pages/auth/BrowserSessionPage.js";
import { LoginPage } from "../pages/auth/LoginPage.js";
import { DashboardPage } from "../pages/dashboard/DashboardPage.js";
import { DividendCalendarPage } from "../pages/dividends/DividendCalendarPage.js";
import { AppShellPage } from "../pages/layout/AppShellPage.js";
import { PortfolioPage } from "../pages/portfolio/PortfolioPage.js";
import { SettingsDrawerPage } from "../pages/settings/SettingsDrawerPage.js";
import { TickerDetailPage } from "../pages/tickers/TickerDetailPage.js";
import { TransactionsPage } from "../pages/transactions/TransactionsPage.js";

let registered = false;

export function registerTestE2EAssistants(): void {
  if (registered) {
    return;
  }

  webAssistantRegistry
    .register(AppShellPage, appShellAssistantFactory)
    .register(SettingsDrawerPage, settingsAssistantFactory)
    .register(LoginPage, loginAssistantFactory)
    .register(AuthErrorPage, authErrorAssistantFactory)
    .register(BrowserSessionPage, sessionAssistantFactory)
    .register(DashboardPage, dashboardAssistantFactory)
    .register(DividendCalendarPage, dividendsAssistantFactory)
    .register(PortfolioPage, portfolioAssistantFactory)
    .register(TransactionsPage, transactionsAssistantFactory)
    .register(TickerDetailPage, tickerDetailAssistantFactory);

  registered = true;
}
