import { createAssistantFactory } from "@vakwen/test-framework/config";
import { FxTransferActions } from "./FxTransferActions.js";
import { FxTransferArrange } from "./FxTransferArrange.js";
import { FxTransferAssert } from "./FxTransferAssert.js";

export const fxTransferAssistantFactory = createAssistantFactory({
  Arrange: FxTransferArrange,
  Actions: FxTransferActions,
  Assert: FxTransferAssert,
});

export type TFxTransferAssistant = ReturnType<typeof fxTransferAssistantFactory>;

export * from "./FxTransferArrange.js";
export * from "./FxTransferActions.js";
export * from "./FxTransferAssert.js";
