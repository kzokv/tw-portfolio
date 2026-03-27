import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TAuthErrorAssistant, TLoginAssistant, TSessionAssistant } from "../assistants/auth/index.js";
import type { TDashboardAssistant } from "../assistants/dashboard/index.js";
import type { TAppShellAssistant } from "../assistants/layout/index.js";
import { AuthErrorPage, BrowserSessionPage, LoginPage } from "../pages/auth/index.js";
import { DashboardPage } from "../pages/dashboard/index.js";
import { AppShellPage } from "../pages/layout/index.js";

import { test as base } from "./noAuthBase.js";

export interface TAuthPagesFixtures {
  authError: TAuthErrorAssistant;
  appShell: TAppShellAssistant;
  dashboard: TDashboardAssistant;
  login: TLoginAssistant;
  session: TSessionAssistant;
}

export const test = base.extend<TAuthPagesFixtures>({
  login: createWebFixture<TLoginAssistant>(LoginPage),
  authError: createWebFixture<TAuthErrorAssistant>(AuthErrorPage),
  session: createWebFixture<TSessionAssistant>(BrowserSessionPage),
  dashboard: createWebFixture<TDashboardAssistant>(DashboardPage),
  appShell: createWebFixture<TAppShellAssistant>(AppShellPage),
});

export { expect } from "./noAuthBase.js";
