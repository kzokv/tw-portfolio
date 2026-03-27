import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TPortfolioAssistant } from "../assistants/portfolio/index.js";
import { PortfolioPage } from "../pages/portfolio/PortfolioPage.js";

import { test as base } from "./appShell.js";

export interface TPortfolioFixtures {
  portfolio: TPortfolioAssistant;
}

export const test = base.extend<TPortfolioFixtures>({
  portfolio: createWebFixture<TPortfolioAssistant>(PortfolioPage),
});

export { expect } from "./appShell.js";
