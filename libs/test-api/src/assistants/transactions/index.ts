import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { TransactionsApiActions } from "./TransactionsApiActions.js";
import { TransactionsApiArrange } from "./TransactionsApiArrange.js";
import { TransactionsApiAssert } from "./TransactionsApiAssert.js";

export const transactionsApiAssistantFactory = createAssistantFactory({
  Arrange: TransactionsApiArrange,
  Actions: TransactionsApiActions,
  Assert: TransactionsApiAssert,
});

export type TTransactionsApiAssistant = ReturnType<typeof transactionsApiAssistantFactory>;

export * from "./TransactionsApiActions.js";
export * from "./TransactionsApiArrange.js";
export * from "./TransactionsApiAssert.js";
