import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { DashboardActions } from "./DashboardActions.js";
import { DashboardArrange } from "./DashboardArrange.js";
import { DashboardAssert } from "./DashboardAssert.js";

export const dashboardAssistantFactory = createAssistantFactory({
  Arrange: DashboardArrange,
  Actions: DashboardActions,
  Assert: DashboardAssert,
});

export type TDashboardAssistant = ReturnType<typeof dashboardAssistantFactory>;

export * from "./DashboardArrange.js";
export * from "./DashboardActions.js";
export * from "./DashboardAssert.js";
