import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TDashboardAssistant } from "../assistants/dashboard/index.js";
import { DashboardPage } from "../pages/dashboard/DashboardPage.js";

import { test as base } from "./appShell.js";

export interface TDashboardFixtures {
  dashboard: TDashboardAssistant;
}

export const test = base.extend<TDashboardFixtures>({
  dashboard: createWebFixture<TDashboardAssistant>(DashboardPage),
});

export { expect } from "./appShell.js";
