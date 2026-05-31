import { createAssistantFactory } from "@vakwen/test-framework/config";
import { CashLedgerActions } from "./CashLedgerActions.js";
import { CashLedgerArrange } from "./CashLedgerArrange.js";
import { CashLedgerAssert } from "./CashLedgerAssert.js";

export const cashLedgerAssistantFactory = createAssistantFactory({
  Arrange: CashLedgerArrange,
  Actions: CashLedgerActions,
  Assert: CashLedgerAssert,
});

export type TCashLedgerAssistant = ReturnType<typeof cashLedgerAssistantFactory>;

export * from "./CashLedgerArrange.js";
export * from "./CashLedgerActions.js";
export * from "./CashLedgerAssert.js";
