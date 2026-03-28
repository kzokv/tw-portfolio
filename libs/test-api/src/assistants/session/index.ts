import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { SessionApiActions } from "./SessionApiActions.js";
import { SessionApiArrange } from "./SessionApiArrange.js";
import { SessionApiAssert } from "./SessionApiAssert.js";

export const sessionApiAssistantFactory = createAssistantFactory({
  Arrange: SessionApiArrange,
  Actions: SessionApiActions,
  Assert: SessionApiAssert,
});

export type TSessionApiAssistant = ReturnType<typeof sessionApiAssistantFactory>;

export * from "./SessionApiActions.js";
export * from "./SessionApiArrange.js";
export * from "./SessionApiAssert.js";
