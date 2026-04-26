import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { FxRatesApiActions } from "./FxRatesApiActions.js";
import { FxRatesApiArrange } from "./FxRatesApiArrange.js";
import { FxRatesApiAssert } from "./FxRatesApiAssert.js";

export const fxRatesApiAssistantFactory = createAssistantFactory({
  Arrange: FxRatesApiArrange,
  Actions: FxRatesApiActions,
  Assert: FxRatesApiAssert,
});

export type TFxRatesApiAssistant = ReturnType<typeof fxRatesApiAssistantFactory>;

export * from "./FxRatesApiActions.js";
export * from "./FxRatesApiArrange.js";
export * from "./FxRatesApiAssert.js";
