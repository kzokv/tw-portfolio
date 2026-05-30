import { createAssistantFactory } from "@vakwen/test-framework/config";
import { AdminApiActions } from "./AdminApiActions.js";
import { AdminApiArrange } from "./AdminApiArrange.js";
import { AdminApiAssert } from "./AdminApiAssert.js";

export const adminApiAssistantFactory = createAssistantFactory({
  Arrange: AdminApiArrange,
  Actions: AdminApiActions,
  Assert: AdminApiAssert,
});

export type TAdminApiAssistant = ReturnType<typeof adminApiAssistantFactory>;

export * from "./AdminApiActions.js";
export * from "./AdminApiArrange.js";
export * from "./AdminApiAssert.js";
