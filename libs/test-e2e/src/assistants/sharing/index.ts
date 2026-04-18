import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { SharingActions } from "./SharingActions.js";
import { SharingArrange } from "./SharingArrange.js";
import { SharingAssert } from "./SharingAssert.js";

export const sharingAssistantFactory = createAssistantFactory({
  Arrange: SharingArrange,
  Actions: SharingActions,
  Assert: SharingAssert,
});

export type TSharingAssistant = ReturnType<typeof sharingAssistantFactory>;

export * from "./SharingActions.js";
export * from "./SharingArrange.js";
export * from "./SharingAssert.js";
