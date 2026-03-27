import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

export class DashboardArrange extends BaseArrange {
  declare protected readonly _instance: DashboardPage;
}
