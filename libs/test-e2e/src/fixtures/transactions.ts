import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TTransactionsAssistant } from "../assistants/transactions/index.js";
import { TransactionsPage } from "../pages/transactions/TransactionsPage.js";

import { test as base } from "./appShell.js";

export interface TTransactionsFixtures {
  transactions: TTransactionsAssistant;
}

export const test = base.extend<TTransactionsFixtures>({
  transactions: createWebFixture<TTransactionsAssistant>(TransactionsPage),
});

export { expect } from "./appShell.js";
