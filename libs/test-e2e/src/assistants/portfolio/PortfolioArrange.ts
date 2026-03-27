import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { PortfolioPage } from "../../pages/portfolio/PortfolioPage.js";

export class PortfolioArrange extends BaseArrange {
  declare protected readonly _instance: PortfolioPage;
}
