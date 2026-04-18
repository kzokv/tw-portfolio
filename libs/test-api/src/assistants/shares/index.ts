import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { SharesApiActions } from "./SharesApiActions.js";
import { SharesApiArrange } from "./SharesApiArrange.js";
import { SharesApiAssert } from "./SharesApiAssert.js";

export const sharesApiAssistantFactory = createAssistantFactory({
  Arrange: SharesApiArrange,
  Actions: SharesApiActions,
  Assert: SharesApiAssert,
});

export type TSharesApiAssistant = ReturnType<typeof sharesApiAssistantFactory>;

export * from "./SharesApiActions.js";
export * from "./SharesApiArrange.js";
export * from "./SharesApiAssert.js";
