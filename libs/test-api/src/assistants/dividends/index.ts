import { createAssistantFactory } from "@vakwen/test-framework/config";
import { DividendsApiActions } from "./DividendsApiActions.js";
import { DividendsApiArrange } from "./DividendsApiArrange.js";
import { DividendsApiAssert } from "./DividendsApiAssert.js";

export const dividendsApiAssistantFactory = createAssistantFactory({
  Arrange: DividendsApiArrange,
  Actions: DividendsApiActions,
  Assert: DividendsApiAssert,
});

export type TDividendsApiAssistant = ReturnType<typeof dividendsApiAssistantFactory>;

export * from "./DividendsApiActions.js";
export * from "./DividendsApiArrange.js";
export * from "./DividendsApiAssert.js";
