import { createAssistantFactory } from "@vakwen/test-framework/config";
import { AdminInstrumentsApiActions } from "./AdminInstrumentsApiActions.js";
import { AdminInstrumentsApiArrange } from "./AdminInstrumentsApiArrange.js";
import { AdminInstrumentsApiAssert } from "./AdminInstrumentsApiAssert.js";

export const adminInstrumentsApiAssistantFactory = createAssistantFactory({
  Arrange: AdminInstrumentsApiArrange,
  Actions: AdminInstrumentsApiActions,
  Assert: AdminInstrumentsApiAssert,
});

export type TAdminInstrumentsApiAssistant = ReturnType<typeof adminInstrumentsApiAssistantFactory>;

export * from "./AdminInstrumentsApiActions.js";
export * from "./AdminInstrumentsApiArrange.js";
export * from "./AdminInstrumentsApiAssert.js";
