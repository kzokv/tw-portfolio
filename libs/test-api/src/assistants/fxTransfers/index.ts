import { createAssistantFactory } from "@vakwen/test-framework/config";
import { FxTransfersApiActions } from "./FxTransfersApiActions.js";
import { FxTransfersApiArrange } from "./FxTransfersApiArrange.js";
import { FxTransfersApiAssert } from "./FxTransfersApiAssert.js";

export const fxTransfersApiAssistantFactory = createAssistantFactory({
  Arrange: FxTransfersApiArrange,
  Actions: FxTransfersApiActions,
  Assert: FxTransfersApiAssert,
});

export type TFxTransfersApiAssistant = ReturnType<typeof fxTransfersApiAssistantFactory>;

export * from "./FxTransfersApiActions.js";
export * from "./FxTransfersApiArrange.js";
export * from "./FxTransfersApiAssert.js";
