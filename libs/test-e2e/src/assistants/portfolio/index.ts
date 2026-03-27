import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { PortfolioActions } from "./PortfolioActions.js";
import { PortfolioArrange } from "./PortfolioArrange.js";
import { PortfolioAssert } from "./PortfolioAssert.js";

export const portfolioAssistantFactory = createAssistantFactory({
  Arrange: PortfolioArrange,
  Actions: PortfolioActions,
  Assert: PortfolioAssert,
});

export type TPortfolioAssistant = ReturnType<typeof portfolioAssistantFactory>;

export * from "./PortfolioArrange.js";
export * from "./PortfolioActions.js";
export * from "./PortfolioAssert.js";
