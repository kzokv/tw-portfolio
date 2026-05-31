import { createAssistantFactory } from "@vakwen/test-framework/config";
import { QuotesApiActions } from "./QuotesApiActions.js";
import { QuotesApiArrange } from "./QuotesApiArrange.js";
import { QuotesApiAssert } from "./QuotesApiAssert.js";

export const quotesApiAssistantFactory = createAssistantFactory({
  Arrange: QuotesApiArrange,
  Actions: QuotesApiActions,
  Assert: QuotesApiAssert,
});

export type TQuotesApiAssistant = ReturnType<typeof quotesApiAssistantFactory>;

export * from "./QuotesApiActions.js";
export * from "./QuotesApiArrange.js";
export * from "./QuotesApiAssert.js";
