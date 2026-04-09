import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { DividendsActions } from "./DividendsActions.js";
import { DividendsArrange } from "./DividendsArrange.js";
import { DividendsAssert } from "./DividendsAssert.js";

export const dividendsAssistantFactory = createAssistantFactory({
  Arrange: DividendsArrange,
  Actions: DividendsActions,
  Assert: DividendsAssert,
});

export type TDividendsAssistant = ReturnType<typeof dividendsAssistantFactory>;

export * from "./DividendsArrange.js";
export * from "./DividendsActions.js";
export * from "./DividendsAssert.js";
