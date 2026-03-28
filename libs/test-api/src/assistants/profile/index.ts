import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { ProfileApiActions } from "./ProfileApiActions.js";
import { ProfileApiArrange } from "./ProfileApiArrange.js";
import { ProfileApiAssert } from "./ProfileApiAssert.js";

export const profileApiAssistantFactory = createAssistantFactory({
  Arrange: ProfileApiArrange,
  Actions: ProfileApiActions,
  Assert: ProfileApiAssert,
});

export type TProfileApiAssistant = ReturnType<typeof profileApiAssistantFactory>;

export * from "./ProfileApiActions.js";
export * from "./ProfileApiArrange.js";
export * from "./ProfileApiAssert.js";
