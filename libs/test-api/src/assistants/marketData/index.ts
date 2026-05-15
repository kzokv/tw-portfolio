import { createAssistantFactory } from "@vakwen/test-framework/config";
import { MarketDataApiActions } from "./MarketDataApiActions.js";
import { MarketDataApiArrange } from "./MarketDataApiArrange.js";
import { MarketDataApiAssert } from "./MarketDataApiAssert.js";

export const marketDataApiAssistantFactory = createAssistantFactory({
  Arrange: MarketDataApiArrange,
  Actions: MarketDataApiActions,
  Assert: MarketDataApiAssert,
});

export type TMarketDataApiAssistant = ReturnType<typeof marketDataApiAssistantFactory>;

export * from "./MarketDataApiActions.js";
export * from "./MarketDataApiArrange.js";
export * from "./MarketDataApiAssert.js";
