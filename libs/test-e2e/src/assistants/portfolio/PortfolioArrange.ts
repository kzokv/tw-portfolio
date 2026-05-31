import { BaseArrange } from "@vakwen/test-framework/mixins";

import type { PortfolioPage } from "../../pages/portfolio/PortfolioPage.js";

/** Empty — required by createAssistantFactory's AAA triple. Add page-specific setup here when needed. */
export class PortfolioArrange extends BaseArrange {
  declare protected readonly _instance: PortfolioPage;
}
