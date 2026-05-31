import { createAssistantFactory } from "@vakwen/test-framework/config";
import { AccountsApiActions } from "./AccountsApiActions.js";
import { AccountsApiArrange } from "./AccountsApiArrange.js";
import { AccountsApiAssert } from "./AccountsApiAssert.js";

export const accountsApiAssistantFactory = createAssistantFactory({
  Arrange: AccountsApiArrange,
  Actions: AccountsApiActions,
  Assert: AccountsApiAssert,
});

export type TAccountsApiAssistant = ReturnType<typeof accountsApiAssistantFactory>;

export * from "./AccountsApiActions.js";
export * from "./AccountsApiArrange.js";
export * from "./AccountsApiAssert.js";
