import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

/** Empty — required by createAssistantFactory's AAA triple. Add page-specific setup here when needed. */
export class DashboardArrange extends BaseArrange {
  declare protected readonly _instance: DashboardPage;
}
