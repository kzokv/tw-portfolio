import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { AnonymousShareTokensApiActions } from "./AnonymousShareTokensApiActions.js";
import { AnonymousShareTokensApiArrange } from "./AnonymousShareTokensApiArrange.js";
import { AnonymousShareTokensApiAssert } from "./AnonymousShareTokensApiAssert.js";

export const anonymousShareTokensApiAssistantFactory = createAssistantFactory({
  Arrange: AnonymousShareTokensApiArrange,
  Actions: AnonymousShareTokensApiActions,
  Assert: AnonymousShareTokensApiAssert,
});

export type TAnonymousShareTokensApiAssistant = ReturnType<
  typeof anonymousShareTokensApiAssistantFactory
>;

export * from "./AnonymousShareTokensApiActions.js";
export * from "./AnonymousShareTokensApiArrange.js";
export * from "./AnonymousShareTokensApiAssert.js";
