import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { InstrumentsApiActions } from "./InstrumentsApiActions.js";
import { InstrumentsApiArrange } from "./InstrumentsApiArrange.js";
import { InstrumentsApiAssert } from "./InstrumentsApiAssert.js";

export const instrumentsApiAssistantFactory = createAssistantFactory({
  Arrange: InstrumentsApiArrange,
  Actions: InstrumentsApiActions,
  Assert: InstrumentsApiAssert,
});

export type TInstrumentsApiAssistant = ReturnType<typeof instrumentsApiAssistantFactory>;

export * from "./InstrumentsApiActions.js";
export * from "./InstrumentsApiArrange.js";
export * from "./InstrumentsApiAssert.js";
