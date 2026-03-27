import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { TransactionsActions } from "./TransactionsActions.js";
import { TransactionsArrange } from "./TransactionsArrange.js";
import { TransactionsAssert } from "./TransactionsAssert.js";

export const transactionsAssistantFactory = createAssistantFactory({
  Arrange: TransactionsArrange,
  Actions: TransactionsActions,
  Assert: TransactionsAssert,
});

export type TTransactionsAssistant = ReturnType<typeof transactionsAssistantFactory>;

export * from "./TransactionsArrange.js";
export * from "./TransactionsActions.js";
export * from "./TransactionsAssert.js";
