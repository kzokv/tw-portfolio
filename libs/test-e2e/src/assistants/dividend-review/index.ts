import { createAssistantFactory } from "@vakwen/test-framework/config";
import { DividendReviewActions } from "./DividendReviewActions.js";
import { DividendReviewArrange } from "./DividendReviewArrange.js";
import { DividendReviewAssert } from "./DividendReviewAssert.js";

export const dividendReviewAssistantFactory = createAssistantFactory({
  Arrange: DividendReviewArrange,
  Actions: DividendReviewActions,
  Assert: DividendReviewAssert,
});

export type TDividendReviewAssistant = ReturnType<typeof dividendReviewAssistantFactory>;

export * from "./DividendReviewArrange.js";
export * from "./DividendReviewActions.js";
export * from "./DividendReviewAssert.js";
