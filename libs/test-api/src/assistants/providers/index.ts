import { createAssistantFactory } from "@vakwen/test-framework/config";
import { ProvidersApiActions } from "./ProvidersApiActions.js";
import { ProvidersApiArrange } from "./ProvidersApiArrange.js";
import { ProvidersApiAssert } from "./ProvidersApiAssert.js";

export const providersApiAssistantFactory = createAssistantFactory({
  Arrange: ProvidersApiArrange,
  Actions: ProvidersApiActions,
  Assert: ProvidersApiAssert,
});

export type TProvidersApiAssistant = ReturnType<typeof providersApiAssistantFactory>;

export * from "./ProvidersApiActions.js";
export * from "./ProvidersApiArrange.js";
export * from "./ProvidersApiAssert.js";
