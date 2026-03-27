import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { TickerDetailActions } from "./TickerDetailActions.js";
import { TickerDetailArrange } from "./TickerDetailArrange.js";
import { TickerDetailAssert } from "./TickerDetailAssert.js";

export const tickerDetailAssistantFactory = createAssistantFactory({
  Arrange: TickerDetailArrange,
  Actions: TickerDetailActions,
  Assert: TickerDetailAssert,
});

export type TTickerDetailAssistant = ReturnType<typeof tickerDetailAssistantFactory>;

export * from "./TickerDetailArrange.js";
export * from "./TickerDetailActions.js";
export * from "./TickerDetailAssert.js";
