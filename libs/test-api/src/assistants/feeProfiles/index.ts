import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { FeeProfilesApiActions } from "./FeeProfilesApiActions.js";
import { FeeProfilesApiArrange } from "./FeeProfilesApiArrange.js";
import { FeeProfilesApiAssert } from "./FeeProfilesApiAssert.js";

export const feeProfilesApiAssistantFactory = createAssistantFactory({
  Arrange: FeeProfilesApiArrange,
  Actions: FeeProfilesApiActions,
  Assert: FeeProfilesApiAssert,
});

export type TFeeProfilesApiAssistant = ReturnType<typeof feeProfilesApiAssistantFactory>;

export * from "./FeeProfilesApiActions.js";
export * from "./FeeProfilesApiArrange.js";
export * from "./FeeProfilesApiAssert.js";
